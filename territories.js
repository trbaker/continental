/* CONTINENTAL — territory data
   The 40 territories, their continents, ArcGIS country-name aliases,
   and the adjacency graph (including sea routes). Loaded before game.js. */
'use strict';

/* ---------------- Territory graph (40 territories, 6 continents) -------- */
const CONTINENTS = {
  NA:{name:'North America', bonus:3, color:'#B3541E'},
  SA:{name:'South America', bonus:2, color:'#7A9E3B'},
  EU:{name:'Europe',        bonus:5, color:'#4A6FA5'},
  AF:{name:'Africa',        bonus:4, color:'#C08B2D'},
  AS:{name:'Asia',          bonus:7, color:'#8E5BA6'},
  OC:{name:'Oceania',       bonus:2, color:'#3A9188'},
};

// q = country name aliases used to match the ArcGIS World Countries layer
const TERRITORIES = [
  {id:'grl', name:'Greenland',      cont:'NA', q:['Greenland'], ll:[72,-40]},
  {id:'can', name:'Canada',         cont:'NA', q:['Canada'], ll:[57,-104]},
  {id:'usa', name:'United States',  cont:'NA', q:['United States','United States of America'], ll:[39.5,-98.5]},
  {id:'mex', name:'Mexico',         cont:'NA', q:['Mexico'], ll:[23.8,-102.5]},
  {id:'cub', name:'Cuba',           cont:'NA', q:['Cuba'], ll:[21.5,-79]},

  {id:'col', name:'Colombia',       cont:'SA', q:['Colombia'], ll:[3.9,-73.2]},
  {id:'ven', name:'Venezuela',      cont:'SA', q:['Venezuela','Venezuela, Bolivarian Republic of'], ll:[7.1,-66]},
  {id:'per', name:'Peru',           cont:'SA', q:['Peru'], ll:[-9.6,-75]},
  {id:'bra', name:'Brazil',         cont:'SA', q:['Brazil'], ll:[-9,-52]},
  {id:'arg', name:'Argentina',      cont:'SA', q:['Argentina'], ll:[-34.6,-65.5]},

  {id:'gbr', name:'United Kingdom', cont:'EU', q:['United Kingdom'], ll:[53.6,-1.9]},
  {id:'fra', name:'France',         cont:'EU', q:['France'], ll:[46.9,2.4]},
  {id:'esp', name:'Spain',          cont:'EU', q:['Spain'], ll:[40.1,-3.6]},
  {id:'deu', name:'Germany',        cont:'EU', q:['Germany'], ll:[51,10.2]},
  {id:'ita', name:'Italy',          cont:'EU', q:['Italy'], ll:[42.9,12.9]},
  {id:'swe', name:'Sweden',         cont:'EU', q:['Sweden'], ll:[62.4,15.5]},
  {id:'pol', name:'Poland',         cont:'EU', q:['Poland'], ll:[52.1,19.3]},
  {id:'ukr', name:'Ukraine',        cont:'EU', q:['Ukraine'], ll:[49,31.4]},

  {id:'dza', name:'Algeria',        cont:'AF', q:['Algeria'], ll:[27.9,2.6]},
  {id:'egy', name:'Egypt',          cont:'AF', q:['Egypt'], ll:[26.6,29.8]},
  {id:'nga', name:'Nigeria',        cont:'AF', q:['Nigeria'], ll:[9.5,8]},
  {id:'eth', name:'Ethiopia',       cont:'AF', q:['Ethiopia'], ll:[8.6,39.6]},
  {id:'cod', name:'DR Congo',       cont:'AF', q:['Congo DRC','Democratic Republic of the Congo','Congo, The Democratic Republic of the'], ll:[-2.9,23.6]},
  {id:'zaf', name:'South Africa',   cont:'AF', q:['South Africa'], ll:[-29.2,24.7]},
  {id:'mdg', name:'Madagascar',     cont:'AF', q:['Madagascar'], ll:[-19.3,46.7]},

  {id:'rus', name:'Russia',         cont:'AS', q:['Russian Federation','Russia'], ll:[61,94]},
  {id:'kaz', name:'Kazakhstan',     cont:'AS', q:['Kazakhstan'], ll:[48.3,67]},
  {id:'tur', name:'Turkey',         cont:'AS', q:['Turkiye','Turkey','Türkiye'], ll:[39.1,35.2]},
  {id:'sau', name:'Saudi Arabia',   cont:'AS', q:['Saudi Arabia'], ll:[23.9,45]},
  {id:'irn', name:'Iran',           cont:'AS', q:['Iran','Iran, Islamic Republic of'], ll:[32.4,53.7]},
  {id:'ind', name:'India',          cont:'AS', q:['India'], ll:[22.9,79.6]},
  {id:'chn', name:'China',          cont:'AS', q:['China'], ll:[35.2,103.9]},
  {id:'mng', name:'Mongolia',       cont:'AS', q:['Mongolia'], ll:[46.8,103.8]},
  {id:'jpn', name:'Japan',          cont:'AS', q:['Japan'], ll:[37.2,138.7]},
  {id:'tha', name:'Thailand',       cont:'AS', q:['Thailand'], ll:[15.4,101]},
  {id:'idn', name:'Indonesia',      cont:'AS', q:['Indonesia'], ll:[-1.5,113.5]},

  {id:'aus', name:'Australia',      cont:'OC', q:['Australia'], ll:[-25.3,134]},
  {id:'nzl', name:'New Zealand',    cont:'OC', q:['New Zealand'], ll:[-43.5,170.5]},
  {id:'png', name:'Papua New Guinea', cont:'OC', q:['Papua New Guinea'], ll:[-6.6,144.5]},
  {id:'phl', name:'Philippines',    cont:'OC', q:['Philippines'], ll:[15.5,121.2]},
];

const LINKS = [
  // North America (+ sea routes)
  ['grl','can'],['grl','gbr'],['can','usa'],['usa','mex'],['usa','cub'],['usa','rus'],
  ['mex','cub'],['mex','col'],
  // South America
  ['col','ven'],['col','per'],['col','bra'],['ven','bra'],['per','bra'],['per','arg'],
  ['bra','arg'],['bra','nga'],
  // Europe
  ['gbr','fra'],['gbr','swe'],['fra','esp'],['fra','deu'],['fra','ita'],['esp','ita'],
  ['deu','pol'],['deu','swe'],['deu','ita'],['pol','ukr'],['pol','rus'],['swe','pol'],
  ['swe','rus'],['ukr','rus'],['ukr','tur'],['ita','egy'],['esp','dza'],
  // Africa
  ['dza','egy'],['dza','nga'],['egy','eth'],['egy','sau'],['nga','cod'],['cod','eth'],
  ['cod','zaf'],['eth','mdg'],['eth','sau'],['zaf','mdg'],
  // Asia
  ['rus','kaz'],['rus','chn'],['rus','mng'],['rus','jpn'],['kaz','chn'],['kaz','irn'],
  ['chn','mng'],['chn','ind'],['chn','tha'],['chn','jpn'],['chn','phl'],
  ['ind','irn'],['ind','tha'],['ind','sau'],['irn','tur'],['irn','sau'],
  ['tha','idn'],
  // Oceania
  ['idn','aus'],['idn','png'],['idn','phl'],['aus','nzl'],['aus','png'],['png','phl'],
];

const NEIGHBORS = {};
TERRITORIES.forEach(t => NEIGHBORS[t.id] = new Set());
LINKS.forEach(([a,b]) => { NEIGHBORS[a].add(b); NEIGHBORS[b].add(a); });
const T_BY_ID = Object.fromEntries(TERRITORIES.map(t => [t.id, t]));
const ALIAS = {};
TERRITORIES.forEach(t => t.q.forEach(n => ALIAS[n.toLowerCase()] = t.id));
