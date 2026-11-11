// Estimator AI: reads a bid's pasted email and its documents (plan set PDFs, addenda, specs, RFIs, earlier estimates) and DRAFTS the estimate structure.
// It never saves anything into the estimate by itself: the app loads the draft for the Estimator, who reviews, prices and rearranges (the "last 20%").
// Prices are only filled when there is a real source (the catalog, an earlier submitted estimate in the bid's files, or a number in the email).
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const DIR = process.env.FILES_DIR || path.join(__dirname, '..', 'data', 'files');
const API = 'https://api.anthropic.com/v1/messages';
const RAW_BUDGET = 22 * 1048576;      // the API refuses requests over 32 MB; base64 adds a third
const MAX_PDF_PAGES = 100;            // API limit for PDFs in one request
const MAX_IMAGE = 4.5 * 1048576;
const TEXT_EXT = new Set(['txt', 'csv', 'eml', 'md']);
const IMG = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const extOf = n => { const m = /\.([A-Za-z0-9]+)$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };

function modelName(){
  return process.env.AI_ESTIMATOR_MODEL || process.env.AI_CONTRACT_MODEL || (process.env.AI_ALLOWED_MODELS || '').split(',')[0].trim() || 'claude-sonnet-5-5';
}

// ---------- which of the bid's files the AI can read ----------
function priority(name){
  const n = String(name || '').toLowerCase();
  if(/^gc email/.test(n)) return 100;
  if(/plan|drawing|dwg|sheet|set\b|capex|permit|issued|ifc|bid[ _-]?set|architect|civil|struct|roof/.test(n)) return 20;
  if(/addend|ccd|bulletin|revision/.test(n)) return 16;
  if(/spec/.test(n)) return 12;
  if(/rfi|question|response/.test(n)) return 10;
  if(/estimate|proposal|quote|bid submission/.test(n)) return 8;
  return 1;
}
function pdfPages(buf){
  const s = buf.toString('latin1'); let n = 0, m;
  const re = /\/Type\s*\/Page[^s]/g; while(re.exec(s)) n++;
  // the page tree's own count (only dictionaries that say /Type /Pages, so a bookmarks /Count is not mistaken for pages)
  const tree = /<<[^<>]*\/Type\s*\/Pages[^<>]*>>/g; while((m = tree.exec(s))){ const c = /\/Count\s+(\d+)/.exec(m[0]); if(c) n = Math.max(n, Number(c[1]) || 0); }
  return Math.max(n, 1);
}
async function bidFileRows(bidId){
  const ids = [Number(bidId)]; let cur = Number(bidId);
  for(let i = 0; i < 10; i++){   // a clone also reads its original's files (they are linked, not copied)
    const [r] = await pool.query('SELECT cloned_from FROM est_bids WHERE id = ?', [cur]); const p = r[0] && r[0].cloned_from;
    if(!p || ids.includes(Number(p))) break; ids.push(Number(p)); cur = Number(p);
  }
  const [rows] = await pool.query(`SELECT id, name, stored_name, size, uploaded_at FROM media_files WHERE entity_type = 'bid' AND entity_id IN (${ids.map(() => '?').join(',')}) AND hidden = 0 ORDER BY uploaded_at ASC`, ids.map(String));
  return rows;
}
// Returns { blocks, files:[{name, how}], skipped:[{name, why}] }. Blocks are API content blocks in the order the AI should read them.
async function gather(bidId){
  const rows = await bidFileRows(bidId), files = [], skipped = [], blocks = [];
  const ranked = rows.map(r => ({ r, p: priority(r.name), ext: extOf(r.name) })).sort((a, b) => b.p - a.p || Number(a.r.size) - Number(b.r.size));
  let budget = RAW_BUDGET, pages = 0;
  for(const { r, ext } of ranked){
    const full = path.join(DIR, path.basename(r.stored_name || ''));
    if(!fs.existsSync(full)){ skipped.push({ name: r.name, why: 'the file is missing on the server' }); continue; }
    if(TEXT_EXT.has(ext)){
      let t = (await fs.promises.readFile(full, 'utf8')).replace(/\u0000/g, '');
      const isEmail = /^gc email/i.test(r.name) || ext === 'eml';
      if(t.length > 60000) t = t.slice(0, 60000) + '\n[cut off here: file too long]';
      blocks.push({ type: 'text', text: (isEmail ? "THE GC'S EMAIL (file: " : 'TEXT FILE (') + r.name + '):\n' + t });
      files.push({ name: r.name, how: isEmail ? 'email' : 'text' }); continue;
    }
    if(ext === 'pdf'){
      if(Number(r.size) > budget){ skipped.push({ name: r.name, why: 'too large for the AI to read in one go (' + Math.round(Number(r.size) / 1048576) + ' MB; the limit left was ' + Math.max(0, Math.round(budget / 1048576)) + ' MB)' }); continue; }
      const buf = await fs.promises.readFile(full), pg = pdfPages(buf);
      if(pages + pg > MAX_PDF_PAGES){ skipped.push({ name: r.name, why: 'about ' + pg + ' pages; the AI can read ' + MAX_PDF_PAGES + ' pages at a time (' + pages + ' already used)' }); continue; }
      budget -= buf.length; pages += pg;
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }, title: r.name });
      files.push({ name: r.name, how: 'pdf', pages: pg }); continue;
    }
    if(IMG[ext]){
      if(Number(r.size) > MAX_IMAGE || Number(r.size) > budget){ skipped.push({ name: r.name, why: 'picture too large' }); continue; }
      const buf = await fs.promises.readFile(full); budget -= buf.length;
      blocks.push({ type: 'text', text: 'PICTURE (file: ' + r.name + '):' });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: IMG[ext], data: buf.toString('base64') } });
      files.push({ name: r.name, how: 'picture' }); continue;
    }
    skipped.push({ name: r.name, why: ext === 'docx' || ext === 'doc' || ext === 'xlsx' || ext === 'xls' ? 'Word and Excel files cannot be read yet (save as PDF)' : 'this kind of file cannot be read by the AI' });
  }
  return { blocks, files, skipped };
}

// ---------- the instructions ----------
const SYSTEM = `You are the estimating assistant for Lucas Industrial, LLC, a specialty contractor (structural steel, roofing, field service work, material supply) that mostly works for general contractors on big-box retail stores (Walmart, Sam's Club, Costco and similar). A GC emails a small scope description plus a plan set; Lucas answers with one or more priced estimates. The owner has done this for years and reads between the lines of a short email and a set of drawings. A new estimator stumbles on this. Your job is to draft as much of the estimate STRUCTURE as you can, about 80 percent of the work, so the Estimator can finish the last 20 percent (pricing, moving things around, final judgment).

HOW LUCAS BUILDS AN ESTIMATE (follow this house style):
1. Work is grouped by PIECE OF EQUIPMENT or ITEM named on the plans, per trade. One line per tagged item (for example "RTU-10", "Gas Cooler DTA", "Rack DTB", "Transformer Platform"). Use the exact tag and any weight the drawings give. The same tag list often appears in more than one trade (for example once for the steel framing and once for the roofing flash-in around it). Equipment being removed is grouped the same way (for example "MTC / LTA / MTD / LTB DX units").
2. Each line's title carries the SCOPE LIMITS in capitals: for example "RTU-10 (1,300 LBS) - FRAME WORK ONLY", "GAS COOLER DTA - TPO & INSULATION FLASH-IN", "SUPPLY ONLY", "UNIT REMOVAL NOT INCLUDED". Exclusions live in the title or a row.
3. Under each title, rows (short lines of text) say what is included: for example "Materials & Installation", then the materials and shapes if the plans show them, "includes, as necessary, the framework for the associated pipe penetration", "includes coating".
4. The estimate starts with ONE GENERAL line for the whole job (even when it mixes structural steel and roofing work). Give each trade its own General only when the email asks for separate bids or the bid will clearly be sent as separate estimates (then each carries its own General, as when an alternate is offered). The General rows are: "Mobilization (QTY n)", "Regional Fuel Cost Increase", "Equipment + Transport" (the lifts needed to get on site, by type), "Lodging & Per Diem (n days)" (only when the job is far from Murfreesboro, see the house defaults), and "Administrative / Tax Application Fee / Project Insurance". Size the quantities from the job: more equipment and more months means more mobilizations and lodging days. Say in flags that these quantities are an estimate to confirm.
5. Whole-job items come after the equipment groups (painting and coating, walkway pads, slip sheets, refrigeration line hoods, curb caps, security grating, penetration boxes).
6. An ALTERNATE named in the email (Alternate 1, "deduct", "add alternate") is its own scope "Alternative Work", flagged with the alt label ("Alternate 1"), with its own General line, and its first row says it is only offered with the other estimates. Demolition and in-fill (patching the roof where old equipment is removed) are separate lines per old unit or rack frame.
7. Scopes: put EVERY line of one estimate in ONE scope, "Structural Steel" by default (or "Roofing" when the whole job is roofing), even when the job mixes steel, roofing, equipment rental and crane lines: Lucas sends one flat estimate and the title of each line carries its trade ("... - ROOFING"). Equipment Rental, Crane Rental, General and consumables are lines, not scopes. Use a second scope ONLY when the email asks for separate bids, or for an alternate ("Alternative Work", with the alt label). Other scope names: "Forklift", "Material Supply Only". Never invent a scope name.

READING BETWEEN THE LINES:
- Match each sentence of the email to evidence on the plans (tags, notes, legends, demolition plans, roof details) and build a line for each tagged item the email's scope touches. Cite the evidence briefly in each line's "note" (sheet number and note, or the email phrase).
- Where the email and drawings leave the placement ambiguous (for example whether capping old curbs belongs in the base bid or in the alternate), follow the email's literal wording, and add the question to that line's flags and to "questions". Experienced estimators sometimes place items differently on purpose; the Estimator can move any line.
- Never invent quantities. Take counts from the drawings. When you are not sure, say so in flags ("Verify quantity") and in "note".
- If the email mentions a document that is not among the files (an RFI response, an addendum, a spec section), list it under "missing".
- Flag boilerplate that does not fit the job's region (for example fuel-surcharge wording for another region).

WHEN THE FILES ARE A NARRATIVE, ADDENDUM OR RFI (no full drawings):
- Large plan sets are often too big to attach. An addendum narrative (for example "ADD 1") lists changed sheets and equipment tags sheet by sheet. Build lines from it anyway: Lucas steel scope shows up in the structural sheets (S-sheets: revised openings, roof framing), the mechanical and electrical sheets (tag ranges such as "RTUs 25, 26, 27, 28, 29" or "AHUs 1, 2 and 3", new exhaust fans, hoods, roof curbs, rack and gas cooler views), the exterior sheets (bollards), the door details (jamb and head details), edge-protection and racking sheets.
- A tag range in the narrative IS a quantity: RTUs 25-29 is five units, AHUs 1, 2 and 3 is three. Count the tags yourself, say the tags in a row, and put "QTY n" in the title. Exhaust fans: count every fan the narrative adds (named fans, "exhaust fan #1 and #2", EF numbers, fans for rooms) and flag "Verify quantity" because the count comes from a narrative, not the schedule.
- Equipment that needs a hood, fan or rooftop support is steel work. A new hood or oven exhaust means a SUSPENDED VENT HOOD REINFORCEMENT line; a new rooftop unit means "RTU SUPPORT FRAMING & CURB INSTALL"; AHUs mean "AHU SUPPORT FRAMING"; rooftop refrigeration (rack, gas cooler, condenser) means a "RACK & GAS COOLER SUPPORT FRAMING" line.
- Later documents override earlier ones: RFI response over addendum (CCD) over original set. When an RFI response changes a material or method (for example an approved square tube HSS 3x3x1/4 in place of round pipe with angle iron), write the approved material in the row, name the RFI number in the note, and do not price the old method. Use the newest revision of a document when several exist (R1, R2, R3, R4), and name the revision you used in "reading". If an RFI REQUEST is present but its response is not, put the response under "missing".
- The GC is the customer, not the store brand. "Sam's Club #6506" is the project; the company that sends the email or signs the RFI forwarding (the construction manager) is the customer. Take the store number and city from the project name.
- Say plainly in "reading" and "missing" which large files you could not open, so the Estimator knows the counts are narrative-based.

LABOR-ONLY WORK ON EXISTING STORES (the Nashville pattern: a short list of install items with counts, material by others):
- When the email is a bullet list of install items with counts ("Install (6) KEF curbs", "Install (2) EF curbs", "Reinforce (2) joists for MAU 28"), group by TYPE OF WORK with the count in the title and the tags in an "Applicable Units (...)" row, not one line per tag: for example "MAU SUPPORT FRAMING - QTY 02" with the row "Applicable Units (MAU-37, MAU-28)" (curbs AND joist reinforcement for those units live together), "KEF & EF SUPPORT FRAMING - QTY 06", "CURB INSTALLATION - QTY 12 UNITS - ROOFING" (every curb the email lists, one row per curb type), "FIELD SERVICE OPERATIONS - STRUCTURAL STEEL" (the platform erection and the welded connections: describe the members the drawings show, such as columns, runners, cross members, tension rods, HDG), "FIELD SERVICE OPERATIONS - ROOFING" (dektites, roof patch kits with the count and the kit price in the row when known). Keep one line per tag only for heavy named equipment that is priced individually by weight (RTU-10, a gas cooler, a rack).
- Labor-only: put the row "*** MATERIALS AND FASTENERS SUPPLIED BY <customer> *** NO CHARGE ***" under each line whose material comes from others (the email says "labor quote", or the customer buys material), and do not add material lines.
- Equipment rental on a job like this is its own "EQUIPMENT RENTAL" line (rows "Equipment & Transport", then each lift by size and type with the rental period), in addition to the lift transport rows inside General. Suggest "CRANE RENTAL" ("Subcontract Crane Service") as its own line when the drawings show heavy steel set on a roof (platform columns, girders, rack frames) even if the email does not mention a crane, with the flag "Crane needed?" and a question for the Estimator.
- When steel is installed or modified, add a small consumables line (painting supplies / consumables, matched to the catalog coating item when there is one), flagged "Check price".
- Do not question the customer when the plans name the builder (the title block, the SSC letter or the structural engineer's client): use it as the customer and add one question confirming it.

LUCAS HOUSE DEFAULTS (learned from submitted estimates; follow them unless the documents say otherwise):
- Lucas is based in Murfreesboro, TN. A job within about 90 minutes of Murfreesboro (Nashville, for example) is local: leave "Lodging & Per Diem" OUT of the General. Add it (with a day count you size from the job) only for jobs farther away, and flag the day count.
- Fuel row: for Tennessee and the rest of the Southeast use exactly this text and do not flag it: "Southeast Fuel Surcharge Increase @ Avg. 30% = $250.00 each truck per mobilization." (add " - EST: $<250 x trucks x mobilizations>" only when you know the truck count). For other regions flag the wording.
- Lifts (rows under "Equipment + Transport" in General, and again in the EQUIPMENT RENTAL line with the rental period): size them to the roof or work height the drawings show. Lucas's usual set on a rooftop job is "19 ft. Scissor Lift, Electric, Narrow Cat Class: 300-2000", "39-40 ft. Scissor Lift, Electric, Wide Cat Class: 300-4047" and "JLG E300AJP Boom Lift". Do NOT add a telehandler unless the documents call for moving material at grade or a heavy lift.
- Mobilization quantity: a job with a platform or heavy steel set by a crane, plus separate roofing or curb work, usually takes 2 mobilizations. Say so in a flag.
- General title format: "GENERAL - <store brand> #<store number> <City>, <ST>" and add " (Project: <customer job number>)" when one is known.
- Welded connections and platform erection belong in ONE steel line ("FIELD SERVICE OPERATIONS - STRUCTURAL STEEL") with the members listed from the drawings (for example "4 weld-in girder columns, 2 runners, 9 cross members & 16 tension rods. Materials will come HDG").
- Roof patch kits and dektites: one "FIELD SERVICE OPERATIONS - ROOFING" line; dektites as "Installation & supply" with the counts in the row text ("Dektites for Legs - QTY 8", "Dektites for HVAC - QTY 16"); patch kits under a sub-heading "Roof Patch Kit Installation" with each kit type and count.

EXAMPLE OF THE HOUSE STYLE (a real labor-only job: Costco, Nashville; prices removed; copy the SHAPE, not the quantities):
GENERAL - Costco #630 W Nashville, TN: Mobilization Fee (Mobilizations QTY 2); Fuel Cost Increase (Southeast wording above); Equipment + Transport (QTY 2 - 19 ft. scissor lift narrow; 39-40 ft. scissor lift wide; JLG E300AJP boom lift - 2 day rental); Administrative, Tax Application Fee & Project Insurance.
EQUIPMENT RENTAL: Equipment & Transport; 39-40 ft. scissor lift - 1 week rental; JLG E300AJP boom lift - 1 week rental.
MAU SUPPORT FRAMING - QTY 02: Materials & Installation; Applicable Units (MAU-37, MAU-28); *** MATERIALS AND FASTENERS SUPPLIED BY SPAN CONSTRUCTION *** NO CHARGE ***.
KEF & EF SUPPORT FRAMING - QTY 06: Applicable Units (KEF-8,9,10,12,13,22); Applicable Units (EF-7,25); same materials row.
FIELD SERVICE OPERATIONS - STRUCTURAL STEEL: Materials & Fasteners (all provided by manufacturer, no charge); Installation: erection of the condenser platform with its members, HDG.
CURB INSTALLATION - QTY 12 UNITS - ROOFING: Install (2) MAU curbs; (6) KEF curbs; (2) EF curbs; (2) CLC curbs; roofing materials provided by the customer - no charge.
FIELD SERVICE OPERATIONS - ROOFING: dektites for legs QTY 8, for HVAC QTY 16; roof patch kit and mini roof patch kits.
RTU SUPPORT FRAMING: Coatings & Coating Services; the catalog primer; Painting Supplies/Consumables.
CRANE RENTAL: Crane Service; Subcontract Crane Service.

SMALL FIELD-SERVICE JOBS (paneling, patches, hole repair, a few days on site):
- These bids often arrive with almost no drawings: a few photos, the customer's material order or PO acknowledgement, and a short email. Build the small standard set: a GENERAL line (Mobilization QTY, Regional Fuel Cost Increase, Lodging & Per Diem n days), then ONE field-service line named for the work (for example "FIELD SERVICE OPERATIONS - Paneling Installation" or "PATCHES (QTY 07) & HOLE REPAIR"), then, when lifts are needed, an "EQUIPMENT RENTAL" line listing each machine by type and size ("Equipment + Transport", "39-40 ft. Scissor Lift, Electric", "Boom Lift"). On these small jobs equipment rental is its own line, not rows inside General; on large steel jobs it stays inside General.
- If the customer is buying the material (a supplier order acknowledgement or PO in the files, or the email says so), the line is labor only: add the row "Materials & Fasteners provided by <customer>" and do not add material lines. Use the order (panel counts, lengths, colors) to size the work and write the count in the title as "QTY n".
- Counts written in words in a vendor or subcontractor proposal ("seven (7) interior wall patches", "twelve (12) exterior screw holes") are quantities for the title and rows. A subcontractor's proposal is Lucas's COST, never its price: do not copy a subcontractor's total into "amount"; leave the price empty and add the flag "Sub quote on file" with the number in the line's note, so the Estimator can mark it up.
- A customer job or PO number (for example 01-43-27096 on the order, emails or file names) goes in "reading", and the GENERAL title ends with "- PROJECT <number>". Lucas does no work without a PO, so if none is found add it to "missing".
- Many small jobs come from the same customer as an earlier estimate. Mobilization, lodging and rental amounts from a submitted estimate of the same shape may be reused (priceBasis "submitted_estimate"), but flag them "Check price".

PRICES:
- Fill "amount" only when you have a real source: a catalog item with a price (given below), an earlier submitted Lucas estimate among the files (use its unit prices for the same kind of item), or a number written in the email. Set priceBasis to "catalog", "submitted_estimate" or "email". Otherwise amount is null and priceBasis is "none". Do not guess prices. Do not compute tax.

Reply ONLY by calling the tool submit_estimate_draft. Fill "reading" first: a few sentences on what the email asks for, which documents you read, and how the email maps to the plans.`;

const TOOL = {
  name: 'submit_estimate_draft',
  description: 'Submit the drafted estimate structure for the Estimator to review.',
  input_schema: {
    type: 'object',
    properties: {
      reading: { type: 'string', description: 'A few sentences: what the email asks for, which documents were read, how the email maps to the plans.' },
      bid: { type: 'object', description: 'Details found in the email and documents. Use null for anything not stated.', properties: {
        customer: { type: ['string', 'null'] }, storeNumber: { type: ['string', 'null'] }, address: { type: ['string', 'null'] }, city: { type: ['string', 'null'] }, state: { type: ['string', 'null'], description: 'Two-letter state code' },
        bidDue: { type: ['string', 'null'], description: 'YYYY-MM-DD if the email gives a due date or a weekday relative to the email date' }, startDate: { type: ['string', 'null'], description: 'YYYY-MM-DD construction start' }, endDate: { type: ['string', 'null'], description: 'YYYY-MM-DD construction end' },
        contacts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: ['string', 'null'] }, email: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] } }, required: ['name'] } } } },
      lines: { type: 'array', description: 'Estimate lines in the order they should appear: each trade starts with its GENERAL line, then the equipment groups, then whole-job items.', items: { type: 'object', properties: {
        title: { type: 'string', description: 'Group heading with the scope limits in capitals' },
        scope: { type: 'string' },
        alt: { type: ['string', 'null'], description: 'Alternate label such as "Alternate 1", else null' },
        rows: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, head: { type: 'boolean', description: 'true for a sub-heading row' } }, required: ['text'] } },
        amount: { type: ['number', 'null'] },
        priceBasis: { type: 'string', enum: ['catalog', 'submitted_estimate', 'email', 'none'] },
        flags: { type: 'array', items: { type: 'string' }, description: 'Short chips (under 40 characters) for the Estimator, such as "Verify quantity" or "Placement?"' },
        note: { type: ['string', 'null'], description: 'Where this came from: sheet and note, or the email phrase' } },
        required: ['title', 'scope', 'rows', 'priceBasis'] } },
      questions: { type: 'array', items: { type: 'string' }, description: 'Questions the Estimator should settle (placement, unclear scope, conflicts between email and plans)' },
      missing: { type: 'array', items: { type: 'string' }, description: 'Documents the email refers to or an estimator would expect that are not in the files' }
    },
    required: ['reading', 'lines', 'questions', 'missing']
  }
};

// ---------- calling the API (streamed, so a long answer never times out) ----------
async function callApi(key, model, blocks, system){
  // Some models refuse a forced tool call ("tool_choice: type tool and any are not supported for this model"). Then ask with
  // tool_choice auto, which still ends in the tool call because the system prompt says to reply only by calling it.
  const send = async force => {
    const body = { model, max_tokens: 32000, stream: true, system, tools: [TOOL], messages: [{ role: 'user', content: blocks }] };
    if(force) body.tool_choice = { type: 'tool', name: TOOL.name };
    return fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  };
  let res = await send(true);
  if(!res.ok){
    let j = {}; try{ j = await res.json(); }catch(e){}
    const msg = (j.error && j.error.message) || ('http_' + res.status);
    if(res.status === 400 && /tool_choice/i.test(msg)) res = await send(false);
    else { const e = new Error(msg); e.status = res.status; throw e; }
  }
  if(!res.ok){ let j = {}; try{ j = await res.json(); }catch(e){} const e = new Error((j.error && j.error.message) || ('http_' + res.status)); e.status = res.status; throw e; }
  let buf = '', json = '', stop = '';
  const dec = new TextDecoder();
  const handle = ev => {
    let d; try{ d = JSON.parse(ev); }catch(e){ return; }
    if(d.type === 'content_block_delta' && d.delta && d.delta.type === 'input_json_delta') json += d.delta.partial_json || '';
    else if(d.type === 'message_delta' && d.delta && d.delta.stop_reason) stop = d.delta.stop_reason;
    else if(d.type === 'error'){ const e = new Error((d.error && d.error.message) || 'ai_failed'); e.status = 502; throw e; }
  };
  for await (const chunk of res.body){
    buf += dec.decode(chunk, { stream: true });
    let i; while((i = buf.indexOf('\n\n')) >= 0){
      const evt = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = evt.split('\n').find(l => l.startsWith('data:')); if(line) handle(line.slice(5).trim());
    }
  }
  if(buf.trim()){ const line = buf.split('\n').find(l => l.startsWith('data:')); if(line) handle(line.slice(5).trim()); }
  if(stop === 'max_tokens'){ const e = new Error('The draft was too long for one pass. Try with fewer documents.'); e.code = 'ai_too_long'; throw e; }
  let out; try{ out = JSON.parse(json); }catch(e){ const er = new Error('The AI answer could not be read. Try again.'); er.code = 'ai_bad_answer'; throw er; }
  return out;
}

// ---------- make the answer safe to hand to the app ----------
const clip = (v, n) => v == null ? '' : String(v).replace(/\u0000/g, '').slice(0, n);
const dOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
function clean(out){
  const lines = (Array.isArray(out.lines) ? out.lines : []).slice(0, 150).map(l => {
    let amt = Number(l.amount); const basis = ['catalog', 'submitted_estimate', 'email'].includes(l.priceBasis) ? l.priceBasis : 'none';
    const priced = l.amount != null && Number.isFinite(amt) && amt > 0 && basis !== 'none'; if(!priced) amt = 0;
    const flags = (Array.isArray(l.flags) ? l.flags : []).map(f => clip(f, 40)).filter(Boolean).slice(0, 6);
    if(!priced && !flags.includes('Price needed')) flags.unshift('Price needed');
    return { title: clip(l.title, 200) || 'Untitled line', scope: clip(l.scope, 40) || 'Structural Steel', alt: l.alt ? clip(l.alt, 40) : '',
      rows: (Array.isArray(l.rows) ? l.rows : []).slice(0, 30).map(r => ({ text: clip(r && r.text, 600), head: !!(r && r.head) })).filter(r => r.text),
      amount: Math.round(amt * 100) / 100, priceBasis: priced ? basis : 'none', flags, note: clip(l.note, 400) };
  }).filter(l => l.title);
  const b = out.bid && typeof out.bid === 'object' ? out.bid : {};
  const bid = { customer: clip(b.customer, 200), storeNumber: clip(b.storeNumber, 40), address: clip(b.address, 255), city: clip(b.city, 100), state: clip(b.state, 40),
    bidDue: dOk(b.bidDue) ? b.bidDue : '', startDate: dOk(b.startDate) ? b.startDate : '', endDate: dOk(b.endDate) ? b.endDate : '',
    contacts: (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 8).map(c => ({ name: clip(c && c.name, 120), role: clip(c && c.role, 80), email: clip(c && c.email, 160), phone: clip(c && c.phone, 40) })).filter(c => c.name) };
  const list = a => (Array.isArray(a) ? a : []).slice(0, 25).map(x => clip(x, 400)).filter(Boolean);
  return { reading: clip(out.reading, 3000), bid, lines, questions: list(out.questions), missing: list(out.missing) };
}

// Runs one draft. `onStage` gets small progress words. Returns { draft, files, skipped, model }.
async function draftForBid(bidId, onStage){
  const key = process.env.ANTHROPIC_API_KEY; if(!key){ const e = new Error('ai_not_configured'); e.code = 'ai_not_configured'; throw e; }
  const [bid] = await pool.query('SELECT name, customer, store_number, address, city, state, bid_due, start_date, end_date FROM est_bids WHERE id = ?', [bidId]); if(!bid.length){ const e = new Error('not_found'); e.code = 'not_found'; throw e; }
  onStage && onStage('Reading the documents');
  const g = await gather(bidId);
  if(!g.files.length){ const e = new Error('There is nothing the AI can read yet. Add the GC email and the plan set (PDF) to the bid\'s files.'); e.code = 'no_documents'; throw e; }
  const [cat] = await pool.query('SELECT name, category, unit, unit_price, stock_no FROM est_catalog WHERE active = 1 ORDER BY category, name LIMIT 250');
  const catText = cat.length ? cat.map(c => '- ' + c.name + ' [' + c.category + (c.stock_no ? ', stock ' + c.stock_no : '') + '] ' + (c.unit_price == null ? 'no price yet' : '$' + Number(c.unit_price).toFixed(2) + ' per ' + c.unit)).join('\n') : '(the catalog is empty)';
  const b = bid[0];
  const head = 'Bid on file: "' + b.name + '"' + (b.customer ? ', customer ' + b.customer : '') + (b.store_number ? ', store ' + b.store_number : '') + (b.city ? ', ' + b.city + (b.state ? ', ' + b.state : '') : '') + '. Today is ' + new Date().toISOString().slice(0, 10) + '.\n\nLUCAS PRODUCT CATALOG (the only price source besides earlier submitted estimates and the email):\n' + catText +
    '\n\nThe GC\'s email and the documents follow. Draft the estimate now.';
  const blocks = [{ type: 'text', text: head }].concat(g.blocks);
  onStage && onStage('Drafting the estimate');
  const model = modelName();
  const out = await callApi(key, model, blocks, SYSTEM);
  return { draft: clean(out), files: g.files, skipped: g.skipped, model };
}

module.exports = { draftForBid, gather, clean, callApi, pdfPages, priority, modelName, TOOL, SYSTEM };
