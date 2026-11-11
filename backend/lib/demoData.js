// Demo data for trying the Estimator without real jobs. Loaded (and archived again) by a Builder from the Estimator dashboard. Every bid name starts with "DEMO · ".
// Dates marked ...Rel are days from the day it is loaded (so Draft/Bidding bids never start out already late); the rest are fixed.
module.exports = {
 "bids": [
  {
   "key": 1,
   "name": "Sam's Club #6506-1012 - Albany, GA",
   "storeNumber": "6506-1012",
   "customer": "Berry Hutton Construction",
   "address": "1201 N Westover Blvd",
   "city": "Albany",
   "state": "GA",
   "lat": 31.5785,
   "lon": -84.2174,
   "amount": 262992.76,
   "status": "Won",
   "notes": "Estimate #1961. STEEL BID NOT TO BE SEPARATED. Considers ADD 01.",
   "bidDue": "2026-04-07",
   "bidSubmitted": "2026-04-07",
   "decidedOn": "2026-05-12",
   "startDate": "2026-06-07",
   "endDate": "2026-10-29"
  },
  {
   "key": 2,
   "name": "Costco #1093 Marlboro, NJ",
   "storeNumber": "1093",
   "customer": "Span Construction",
   "address": "",
   "city": "Marlboro",
   "state": "NJ",
   "lat": 40.3154,
   "lon": -74.2465,
   "amount": 184500,
   "status": "Bidding",
   "notes": "",
   "bidDueRel": 9,
   "bidSubmittedRel": -7,
   "decidedOn": "",
   "startDate": "",
   "endDate": ""
  },
  {
   "key": 3,
   "name": "Walmart #4415-1000 El Paso, TX",
   "storeNumber": "4415-1000",
   "customer": "DEEM",
   "address": "",
   "city": "El Paso",
   "state": "TX",
   "lat": 31.7619,
   "lon": -106.485,
   "amount": 0,
   "status": "Draft",
   "notes": "",
   "bidDueRel": 19,
   "bidSubmitted": "",
   "decidedOn": "",
   "startDate": "",
   "endDate": ""
  },
  {
   "key": 4,
   "name": "Sam's Club #6471 - Tupelo, MS",
   "storeNumber": "6471",
   "customer": "Berry Hutton Construction",
   "address": "",
   "city": "Tupelo",
   "state": "MS",
   "lat": 34.2576,
   "lon": -88.7034,
   "amount": 148200,
   "status": "Won",
   "notes": "",
   "bidDue": "2026-08-14",
   "bidSubmitted": "2026-08-12",
   "decidedOn": "2026-09-02",
   "startDate": "",
   "endDate": ""
  },
  {
   "key": 5,
   "name": "Costco #1122 - Baxter, MN",
   "storeNumber": "1122",
   "customer": "Span Construction",
   "address": "",
   "city": "Baxter",
   "state": "MN",
   "lat": 46.3433,
   "lon": -94.2867,
   "amount": 0,
   "status": "Bidding",
   "notes": "",
   "bidDueRel": 9,
   "bidSubmittedRel": -6,
   "decidedOn": "",
   "startDate": "",
   "endDate": ""
  },
  {
   "key": 6,
   "name": "Walmart #2210 - Lubbock, TX",
   "storeNumber": "2210",
   "customer": "Berry Hutton Construction",
   "address": "",
   "city": "Lubbock",
   "state": "TX",
   "lat": 33.5779,
   "lon": -101.8552,
   "amount": 96400,
   "status": "Lost",
   "notes": "",
   "bidDue": "2026-06-02",
   "bidSubmitted": "2026-05-30",
   "decidedOn": "2026-09-01",
   "startDate": "2026-09-01",
   "endDate": "2026-10-15"
  },
  {
   "key": 7,
   "name": "Sam's Club #4821 - Springfield, MO",
   "storeNumber": "4821",
   "customer": "Berry Hutton Construction",
   "address": "",
   "city": "Springfield",
   "state": "MO",
   "lat": 37.209,
   "lon": -93.2923,
   "amount": 0,
   "status": "Draft",
   "notes": "",
   "bidDueRel": 1,
   "bidSubmitted": "",
   "decidedOn": "",
   "startDateRel": 40,
   "endDate": ""
  },
  {
   "key": 8,
   "name": "Costco #1180 - Fargo, ND",
   "storeNumber": "1180",
   "customer": "Span Construction",
   "address": "",
   "city": "Fargo",
   "state": "ND",
   "lat": 46.8772,
   "lon": -96.7898,
   "amount": 0,
   "status": "Draft",
   "notes": "",
   "bidDueRel": 20,
   "bidSubmitted": "",
   "decidedOn": "",
   "startDate": "",
   "endDate": ""
  }
 ],
 "estimates": {
  "1": {
   "number": "1961",
   "date": "2026-04-07",
   "preparedFor": {
    "name": "Berry Hutton (Sams #6506-1012 - Albany, GA)",
    "lines": [
     "2525 Broad Street",
     "Chattanooga, TN 37408",
     "(865) 566-2186",
     "(423) 267-2234"
    ]
   },
   "tax": 25540.36,
   "notes": [
    "Destination: Sam's Club #6506-1012 - Albany, GA",
    "Address: 1201 N Westover Blvd, Albany, GA 31707",
    "Distance: 6 hr 42 min (399 miles)",
    "Construction Start: 6/7/2026",
    "Construction End: 10/29/2026"
   ],
   "lines": [
    {
     "id": "ld0f5la",
     "title": "GENERAL - Sam's Club #6506-1012 - Albany, GA *** STEEL BID NOT TO BE SEPARATED *** CONSIDERS ADD 01 4/17/2026 ***",
     "amount": 33000,
     "source": "manual",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "rb3mkj1",
       "text": "Mobilization Fee (Mobilizations QTY 04)",
       "head": true
      },
      {
       "id": "rx03hdp",
       "text": "Mobile operations covers the following and is based on but not limited to: distance, repetitive visits, general liability insurance, work product insurance, workers’ compensation insurance, job specific employee training, preparation of materials, tools, consumables, hardware, fuel loading and wear/tear towards vehicles, trailers, and mobile equipment.",
       "head": false
      },
      {
       "id": "rnc6de5",
       "text": "Regional Fuel Cost Increase",
       "head": true
      },
      {
       "id": "rg8hp8a",
       "text": "Southeast Fuel Surcharge Increase @ Avg. 30% = $250.00 each truck per mobilization.- EST: $750.00",
       "head": false
      },
      {
       "id": "ralnryx",
       "text": "Equipment + Transport",
       "head": true
      },
      {
       "id": "r1ab6wl",
       "text": "QTY 4 - 24-26 ft. Scissor Lift, Electric, Narrow - Cat Class: 300-2515",
       "head": false
      },
      {
       "id": "ran1kaq",
       "text": "Lodging & Per Diem (Estimated Days 40)",
       "head": true
      },
      {
       "id": "rkfrkj3",
       "text": "Administrative, Tax Application Fee & Project Insurance",
       "head": false
      }
     ]
    },
    {
     "id": "lgo5ry5",
     "title": "BOLLARDS *** SUPPLY ONLY ***",
     "amount": 6952.4,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "Priced from material cost"
     ],
     "rows": [
      {
       "id": "r28jalk",
       "text": "Materials 6\" @ 96\"",
       "head": true
      },
      {
       "id": "r4zoqoi",
       "text": "Stock#: T56G - 6\" SCH 40 (6.625\" OD X .280\" wall) Galvanized Pipe 6\" 20.49 lb/ft - QTY 13",
       "head": false
      }
     ]
    },
    {
     "id": "lsxlyde",
     "title": "EF FRAMING INSTALL - QTY 10 *** NO CURB INSTALL ***",
     "amount": 20000,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "r7gy3co",
       "text": "Materials & Installation",
       "head": true
      },
      {
       "id": "rvzt1h5",
       "text": "Stock#: A25314 5\" X 3\" X 1/4\"A-36 Steel Angle",
       "head": false
      }
     ]
    },
    {
     "id": "leltlhb",
     "title": "SUSPENDED VENT HOOD REINFORCEMENT - QTY 02",
     "amount": 2500,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "r6cvug1",
       "text": "Materials & Installation",
       "head": true
      },
      {
       "id": "r09pyxi",
       "text": "Stock#: A122316 - 2\" X 2\" X 3/16\" A-36 Steel Angle 2.44 lb/ft",
       "head": false
      }
     ]
    },
    {
     "id": "ltray5p",
     "title": "RTU SUPPORT FRAMING & CURB INSTALL - QTY 05",
     "amount": 17500,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "Qty 5 matches RTUs 25-29 in ADD 1"
     ],
     "rows": [
      {
       "id": "rzact9b",
       "text": "Materials & Installation",
       "head": true
      },
      {
       "id": "r8tuann",
       "text": "Stock#: A122316 - 2\" X 2\" X 3/16\" A-36 Steel Angle 2.44 lb/ft  - (Bulk Stock)",
       "head": false
      },
      {
       "id": "r1q1n7v",
       "text": "Stock#: R112 - 1/2 inch Dia. Hot Rolled A-36 Steel Round  0.67 lb/ft  - (Bulk Stock)",
       "head": false
      },
      {
       "id": "rg38tti",
       "text": "Stock#: F13164 - 3/16\" X 4\" Hot Rolled A-36 Steel Flat 2.55 lb/ft  - (Bulk Stock)",
       "head": false
      }
     ]
    },
    {
     "id": "ldyze57",
     "title": "AHU SUPPORT FRAMING - QTY 03",
     "amount": 12000,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "Qty 3 matches AHUs 1-3 in ADD 1"
     ],
     "rows": [
      {
       "id": "r12psvl",
       "text": "Materials & Installation",
       "head": true
      },
      {
       "id": "r4i52wh",
       "text": "Stock#: A122316 - 2\" X 2\" X 3/16\" A-36 Steel Angle 2.44 lb/ft  - (Bulk Stock)",
       "head": false
      },
      {
       "id": "rf8wnm1",
       "text": "Stock#: C2682 - 6\" x 8.2 (6\" X 1.92\" X .200\") A-36 Steel Channel 8.20 lb/ft  - (Bulk Stock)",
       "head": false
      },
      {
       "id": "rs2qf0s",
       "text": "Stock#: T13338 - 3\" X 3\" X 3/8\" wall A500 Square Steel Tube 12.17 lb/ft  - (Bulk Stock)",
       "head": false
      },
      {
       "id": "r6l4f13",
       "text": "Stock#: A26638 6\" X 6\" X 3/8\" A-36 Steel Angle 14.90 lb/ft  - (Bulk Stock)",
       "head": false
      }
     ]
    },
    {
     "id": "lqddw15",
     "title": "RACK-C & GAS COOLER SUPPORT FRAMING - QTY 2",
     "amount": 30000,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "RFI 0005: HSS 3x3x1/4 approved for columns"
     ],
     "rows": [
      {
       "id": "rbbd0xu",
       "text": "Materials & Installation",
       "head": true
      },
      {
       "id": "rtni5t2",
       "text": "Stock#: A122316 - 2\" X 2\" X 3/16\" A-36 Steel Angle 2.44 lb/ft  - (Bulk Stock)",
       "head": false
      },
      {
       "id": "r7934qr",
       "text": "Stock#: R134 - 3/4 inch Dia. Hot Rolled A-36 Steel Round 1.50 lb/ft  - (Bulk Stock)",
       "head": false
      },
      {
       "id": "repn69p",
       "text": "Stock#: C2682 - 6\" x 8.2 (6\" X 1.92\" X .200\") A-36 Steel Channel 8.20 lb/ft  - (Bulk Stock)",
       "head": false
      }
     ]
    },
    {
     "id": "lsqnq89",
     "title": "PROTECTOR ANGLE *** INCLUDES INSTALLATION & COATING ***",
     "amount": 21000,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "rya0hvz",
       "text": "Materials, Installation & Coatings",
       "head": true
      },
      {
       "id": "rnp5q6w",
       "text": "Stock#: A26438 - 6\" X 4\" X 3/8\" A-36 Steel Angle 12.30 lb/ft - QTY 03",
       "head": false
      },
      {
       "id": "r812nxq",
       "text": "Stock#: 91578A834 - Steel Wedge Anchor for Concrete 1/2\" Diameter, 3-3/4\" Long - QTY 01 PK",
       "head": false
      },
      {
       "id": "ryw1y2r",
       "text": "Stock#: 7709T217 - Low-Odor Paint for Metal Safety Yellow (Gloss), 1 Gallon Can - QTY 06 Gal.",
       "head": false
      }
     ]
    },
    {
     "id": "ltu0i1m",
     "title": "OFFICE MEZZANINE LADDER - QTY 01 *** INCLUDES INSTALLATION & COATING ***",
     "amount": 4000,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "rm8vkmc",
       "text": "Fabrication & Installation",
       "head": true
      }
     ]
    },
    {
     "id": "lpukalt",
     "title": "DOOR HOOD - QTY 01 *** NO COATINGS ***",
     "amount": 3500,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "Verify length"
     ],
     "rows": [
      {
       "id": "rhvmi61",
       "text": "Fabrication & Installation",
       "head": true
      },
      {
       "id": "r10bt4n",
       "text": "*** Unit Length: Verify W/PM ***",
       "head": false
      }
     ]
    },
    {
     "id": "lin7m0z",
     "title": "HALF WALL POSTS - QTY 08 @ PH & QTY 03 @ VC *** SUPPLY ONLY ***",
     "amount": 5500,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "r46q7d1",
       "text": "Materials & Fabrication",
       "head": true
      },
      {
       "id": "ra0s3dg",
       "text": "Stock#: T1212316 - 2-1/2\" X 2-1/2\" X 3/16\" wall A500 Square Steel Tube 5.59 lb/ft",
       "head": false
      },
      {
       "id": "rhcq9y1",
       "text": "Stock#: T133316 - 3\" X 3\" X 3/16\" wall A500 Square Steel Tube 6.87 lb/ft",
       "head": false
      },
      {
       "id": "r61f6xm",
       "text": "Stock#: F2126 - 1/2\" X 6\" Hot Rolled A-36 Steel Flat 10.20 lb/ft",
       "head": false
      }
     ]
    },
    {
     "id": "lf1tlj4",
     "title": "DOOR JAMBS & HEADER (400A & 402A) *** NO COATING ***",
     "amount": 10000,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "Doors 400A, 402A named in ADD 1 (A8)"
     ],
     "rows": [
      {
       "id": "rpl6d4o",
       "text": "Materials, Fasteners, Fabrication & Installation",
       "head": true
      },
      {
       "id": "rp4wp9z",
       "text": "Stock# P114 - 1/4 inch THICK A36 Steel Plate 10.21 lb/sqft - QTY 01",
       "head": false
      },
      {
       "id": "r368l2d",
       "text": "Stock# 1004729616 - #12 x 1-1/2 in. Zinc Plated Drive Sheet Metal Screws - QTY 01pk",
       "head": false
      },
      {
       "id": "rucp5dj",
       "text": "Includes:\n1A: Shear & CNC Brake / Fabrication - Parts QTY 3\n1B: Des: 96\" L, 8.0\" Throat, 2 Legs @ 2\" Broke @ 90 Deg. Same Direction (Field Verify)\n2: Cut To Length & Miter Corners (Field Verify)\n3: Install Every 18\" OC Countersunk Hole For Flush Mount Screw\n4: Install Construction Adhesive To Inside of Jambs & Header\n5: Pre-Shave Wall Material & Fit Header + 2 Jambs\n6: Weld All Miter Joints & Grind Exterior Smooth\n7: Clean Area & Provide Photos To Superintendent",
       "head": false
      }
     ]
    },
    {
     "id": "ltazbhb",
     "title": "*** ADD 01 *** POST CROSS BEAM - QTY 09 *** SUPPLY ONLY ***",
     "amount": 16000,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "rbcg4pr",
       "text": "Materials & Fabrication",
       "head": true
      },
      {
       "id": "rllimey",
       "text": "Stock#: T5610 - 6\" SCH 10 (6.625 OD X .134wall) A-500 ERW Structural Steel Pipe",
       "head": false
      },
      {
       "id": "r5xfbep",
       "text": "Stock#: 44605K297 - Low-Pressure Pipe Fitting, Iron, 90 Degree Elbow Connector, 6 NPT Female",
       "head": false
      },
      {
       "id": "r1uq28l",
       "text": "Stock#: F21210 - 1/2\" X 10\" Hot Rolled A-36 Steel Flat 17.00 lb/ft (Base Plates - QTY 18)",
       "head": false
      }
     ],
     "alt": "ADD 01"
    },
    {
     "id": "lj0k0pz",
     "title": "LINTEL - QTY 03 *** SUPPLY ONLY *** ((( VERIFY LENGTH )))",
     "amount": 3000,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "Verify length"
     ],
     "rows": [
      {
       "id": "r8aujgu",
       "text": "Materials",
       "head": true
      },
      {
       "id": "rgw22m0",
       "text": "Stock#: B2824 - W 8 x 24 lb (7.93\" x .245\" x 6.495\") A572/A992 Wide Flange Steel Beam 24.00 lb/ft",
       "head": false
      },
      {
       "id": "r0gofai",
       "text": "Stock#: 90578A644 - Weld Anchor for Concrete 1/2\" Diameter, 5-5/16\" Long - QTY 02 PK",
       "head": false
      }
     ]
    },
    {
     "id": "l1da0y5",
     "title": "TIRE CENTER SHORING/LINTEL & BEAMS *** NO MASONRY OR CONCRETE WORK ***",
     "amount": 15000,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "r2todwq",
       "text": "Materials & Installation (*** STEEL WORK ONLY ***)",
       "head": true
      },
      {
       "id": "r8o9vme",
       "text": "Stock#: T166316 - 6\" X 6\" X 3/16\" wall A500 Square Steel Tube 14.65 lb/ft",
       "head": false
      },
      {
       "id": "rl0xa6x",
       "text": "Stock#: B21636 - W 16 x 36 lb (15.86\" x .295\" x 6.985\") A572/A992 36.00 lb/ft",
       "head": false
      },
      {
       "id": "rnkg3nc",
       "text": "Stock#: 99086A251 - Threaded Rod Zinc Yellow-Chromate Plated, 3/4\"-10 Thread Size",
       "head": false
      },
      {
       "id": "ry7dd28",
       "text": "NOTE: Manufacture on-site block ties",
       "head": false
      }
     ]
    },
    {
     "id": "lqj4x6r",
     "title": "ROLL DOWN DOOR POSTS",
     "amount": 5000,
     "source": "ai",
     "reviewed": false,
     "flags": [
      "RFI: rolldown door post at roof"
     ],
     "rows": [
      {
       "id": "rqxkdgd",
       "text": "Materials & Installation (*** STEEL WORK ONLY ***)",
       "head": true
      },
      {
       "id": "r1p2js9",
       "text": "Stock#: T144316 - 4\" X 4\" X 3/16\" wall A500 Square Steel Tube 9.42 lb/ft",
       "head": false
      },
      {
       "id": "r3zxj3l",
       "text": "Stock#: P1316 - 3/16 inch THICK A36 Steel Plate 7.66 lb/sqft",
       "head": false
      }
     ]
    },
    {
     "id": "l05kh3c",
     "title": "CU-2 & PIPE PENETRATION FRAMING & REINFORCEMENT",
     "amount": 3500,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "r1yexuy",
       "text": "Materials & Installation",
       "head": true
      }
     ]
    },
    {
     "id": "lbw4lua",
     "title": "BULKHEAD REINFORCEMENT",
     "amount": 4500,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "rabyj0r",
       "text": "Materials & Installation",
       "head": true
      },
      {
       "id": "r0n3joa",
       "text": "Stock#: A122316 - 2\" X 2\" X 3/16\" A-36 Steel Angle 2.44 lb/ft  - (Bulk Stock)",
       "head": false
      }
     ]
    },
    {
     "id": "low67q1",
     "title": "CURB CAPS & SECURITY RODS - QTY 07 *** WELDING INCLUDED ***",
     "amount": 24500,
     "source": "ai",
     "reviewed": false,
     "flags": [],
     "rows": [
      {
       "id": "rq4j7qz",
       "text": "Materials & Installation",
       "head": true
      }
     ]
    }
   ]
  },
  "3": {
   "number": "2126",
   "date": "2026-11-02",
   "preparedFor": {
    "name": "DEEM",
    "lines": [
     "El Paso, TX"
    ]
   },
   "tax": 0,
   "scopeTax": {
    "Structural Steel": 2647,
    "Roofing": 4889
   },
   "notes": [],
   "lines": [
    {
     "id": "s0",
     "title": "Steel columns",
     "amount": 6000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s0r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s1",
     "title": "Steel beams",
     "amount": 3000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s1r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s2",
     "title": "Bollards",
     "amount": 2500,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s2r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s3",
     "title": "Embeds",
     "amount": 750,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s3r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s4",
     "title": "Canopy framing",
     "amount": 8000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s4r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s5",
     "title": "Misc steel",
     "amount": 7000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s5r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s6",
     "title": "Touch-up",
     "amount": 200,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s6r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r0",
     "title": "Roof tear-off",
     "amount": 9000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r0r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r1",
     "title": "Insulation",
     "amount": 1500,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r1r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r2",
     "title": "Membrane",
     "amount": 6000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r2r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r3",
     "title": "Metal panels",
     "amount": 16500,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r3r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r4",
     "title": "Flashing",
     "amount": 5000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r4r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r5",
     "title": "Curbs",
     "amount": 2000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r5r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r6",
     "title": "Drains",
     "amount": 4000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r6r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r7",
     "title": "Walkway",
     "amount": 5000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r7r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r8",
     "title": "Sealant",
     "amount": 200,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r8r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r9",
     "title": "Cleanup",
     "amount": 500,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r9r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r10",
     "title": "Warranty",
     "amount": 450,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r10r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    }
   ]
  },
  "6": {
   "number": "2102",
   "date": "2026-05-30",
   "preparedFor": {
    "name": "DEEM",
    "lines": [
     "El Paso, TX"
    ]
   },
   "tax": 0,
   "scopeTax": {
    "Structural Steel": 2647,
    "Roofing": 4889
   },
   "notes": [],
   "lines": [
    {
     "id": "s0",
     "title": "Steel columns",
     "amount": 6000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s0r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s1",
     "title": "Steel beams",
     "amount": 3000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s1r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s2",
     "title": "Bollards",
     "amount": 2500,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s2r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s3",
     "title": "Embeds",
     "amount": 750,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s3r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s4",
     "title": "Canopy framing",
     "amount": 8000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s4r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s5",
     "title": "Misc steel",
     "amount": 7000,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s5r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "s6",
     "title": "Touch-up",
     "amount": 200,
     "scope": "Structural Steel",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "s6r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r0",
     "title": "Roof tear-off",
     "amount": 9000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r0r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r1",
     "title": "Insulation",
     "amount": 1500,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r1r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r2",
     "title": "Membrane",
     "amount": 6000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r2r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r3",
     "title": "Metal panels",
     "amount": 16500,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r3r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r4",
     "title": "Flashing",
     "amount": 5000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r4r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r5",
     "title": "Curbs",
     "amount": 2000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r5r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r6",
     "title": "Drains",
     "amount": 4000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r6r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r7",
     "title": "Walkway",
     "amount": 5000,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r7r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r8",
     "title": "Sealant",
     "amount": 200,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r8r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r9",
     "title": "Cleanup",
     "amount": 500,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r9r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    },
    {
     "id": "r10",
     "title": "Warranty",
     "amount": 450,
     "scope": "Roofing",
     "source": "manual",
     "reviewed": true,
     "flags": [],
     "rows": [
      {
       "id": "r10r",
       "text": "Furnish and install",
       "head": false
      }
     ]
    }
   ]
  }
 },
 "catalog": [
  {
   "category": "Materials",
   "stockNo": "A26438",
   "name": "6\" X 4\" X 3/8\" A-36 Steel Angle 12.30 lb/ft",
   "description": "6\" X 4\" X 3/8\" A-36 Steel Angle 12.30 lb/ft",
   "unit": "ft",
   "unitPrice": 4.85,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #1961 / #2126"
  },
  {
   "category": "Materials",
   "stockNo": "A122316",
   "name": "2\" X 2\" X 3/16\" A-36 Steel Angle 2.44 lb/ft",
   "description": "2\" X 2\" X 3/16\" A-36 Steel Angle 2.44 lb/ft",
   "unit": "ft",
   "unitPrice": null,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #1961"
  },
  {
   "category": "Materials",
   "stockNo": "T5610",
   "name": "6\" SCH 10",
   "description": "6\" SCH 10 (6.625 OD X .134wall) A-500 ERW Structural Steel Pipe",
   "unit": "ft",
   "unitPrice": null,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #1961"
  },
  {
   "category": "Materials",
   "stockNo": "T144316",
   "name": "4\" X 4\" X 3/16\" wall A500 Square Tube",
   "description": "4\" X 4\" X 3/16\" wall A500 Square Tube",
   "unit": "ft",
   "unitPrice": null,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #1961"
  },
  {
   "category": "Materials",
   "stockNo": "B2824",
   "name": "W 8 x 24 lb",
   "description": "W 8 x 24 lb (7.93\" x .245\" x 6.495\") Wide Flange Beam",
   "unit": "ft",
   "unitPrice": null,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #1961"
  },
  {
   "category": "Materials",
   "stockNo": "91578A118",
   "name": "Steel Wedge Anchor for Concrete 1/2\"x5.5\"",
   "description": "Steel Wedge Anchor for Concrete 1/2\"x5.5\"",
   "unit": "ea",
   "unitPrice": null,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #2126"
  },
  {
   "category": "Consumables",
   "stockNo": "31315A112",
   "name": "High-Speed Steel, 1\" Cutting Depth, 9/16\" Diameter",
   "description": "High-Speed Steel, 1\" Cutting Depth, 9/16\" Diameter",
   "unit": "ea",
   "unitPrice": null,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #2126"
  },
  {
   "category": "Consumables",
   "stockNo": "8948A26",
   "name": "SDS-Plus Shank, Standard Point, 1/2\" Size, 10-5/8\" Long",
   "description": "SDS-Plus Shank, Standard Point, 1/2\" Size, 10-5/8\" Long",
   "unit": "ea",
   "unitPrice": null,
   "icon": "",
   "taxable": true,
   "notes": "",
   "source": "DEMO · Estimate #2126"
  },
  {
   "category": "Transport",
   "stockNo": "",
   "name": "Hot Shot Shipping Services",
   "description": "Hot Shot Shipping Services (load weight, miles, drive time)",
   "unit": "mi",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #2126"
  },
  {
   "category": "Transport",
   "stockNo": "",
   "name": "Mobilization Fee",
   "description": "Mobilization Fee (mobilizations QTY) - distance, repetitive visits, insurance, job training, preparation of materials, tools, consumables, fuel loading and wear/tear",
   "unit": "ea",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #2118"
  },
  {
   "category": "Transport",
   "stockNo": "",
   "name": "Regional Fuel Cost Increase",
   "description": "Regional Fuel Cost Increase - Southeast Fuel Surcharge Increase @ Avg. 30% = $250.00 each truck per mobilization",
   "unit": "ea",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #2118"
  },
  {
   "category": "Other",
   "stockNo": "",
   "name": "Administrative, Tax Application Fee & Project Insurance",
   "description": "Administrative, Tax Application Fee & Project Insurance",
   "unit": "ea",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #2118"
  },
  {
   "category": "Installation",
   "stockNo": "",
   "name": "Paneling Installation",
   "description": "Paneling Installation - materials & fasteners provided by the customer",
   "unit": "sf",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #2118"
  },
  {
   "category": "Lodging & Per Diem",
   "stockNo": "",
   "name": "Lodging & Per Diem",
   "description": "Lodging & Per Diem (estimated days)",
   "unit": "day",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #2126 / #2118"
  },
  {
   "category": "Installation",
   "stockNo": "",
   "name": "Installation",
   "description": "Installation",
   "unit": "hr",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #1961"
  },
  {
   "category": "Fabrication",
   "stockNo": "",
   "name": "Fabrication & Processing",
   "description": "Fabrication & Processing",
   "unit": "hr",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #1961"
  },
  {
   "category": "Coatings",
   "stockNo": "",
   "name": "Coatings",
   "description": "Coatings (prime / paint)",
   "unit": "sf",
   "unitPrice": null,
   "icon": "",
   "taxable": false,
   "notes": "",
   "source": "DEMO · Estimate #1961"
  }
 ]
};
