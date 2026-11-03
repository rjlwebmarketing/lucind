// Regenerates lib/calc.js from the page, so the server and the page use the SAME money / labor / close-out math.
// Usage (from the dev workspace): node tools/build-calc.js /path/to/dispatch-board.html
const fs = require('fs'), path = require('path');
const page = fs.readFileSync(process.argv[2] || '/home/claude/dispatch-board.html', 'utf8');
const grab = (a, b) => { const i = page.indexOf(a), j = page.indexOf(b); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return page.slice(i, j + b.length); };
const code = grab('/* MONEY-CALC-START', '/* MONEY-CALC-END */') + '\n' + grab('/* BIDS-CALC-START', '/* BIDS-CALC-END */') + '\n' + grab('/* LABOR-CALC-START', '/* LABOR-CALC-END */');
const out = `// GENERATED from the page by tools/build-calc.js. Do not edit by hand.
module.exports = function makeCalc(board) {
${code}
MONEY_LABOR_CTX = () => ({ people: board.people || [], labor: laborClean(board.moneySettings && board.moneySettings.labor) });
return { moneySummary, projectCloseReadiness, projectCloseSnapshot, moneyLive, moneyNum, moneyRound, dealPaid, dealRequested, payAppStatus, projectLaborCost, laborClean, w2Wage, bidStatusOf };
};
`;
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'calc.js'), out);
console.log('lib/calc.js written, ' + out.length + ' bytes');
