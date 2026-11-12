const L = require('../js/library.js'); const E = require('../js/engine.js'); const A = require('../js/agents.js');
const LIB = Object.fromEntries(L.SOURCES.map((s) => [s.id, s]));
async function demoRun(question, extra) { const eng = E.createEngine({ agents: A.demoAgents({ library: L }), input: Object.assign({ question, autoApprove: true }, extra || {}) }); await eng.start(); return eng; }
module.exports = { L, E, A, LIB, demoRun };
