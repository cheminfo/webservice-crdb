'use strict';

const MAX_VALUE = 0xffffffff;
const NUMERIC_FIELDS = [
    'em',
    'mw',
    'logp',
    'logs',
    'psa',
    'acc',
    'don',
    'rot',
    'ste'
];

const crdb = require('crdb');
const fs = require('fs');
const path = require('path');
const Molecule = require('openchemlib').Molecule;
const comparators = crdb.comparators;

let config;
try {
    config = require('./config.json');
} catch (e) {
    console.error('config.json not found');
    process.exit(1);
}

let data = fs.readFileSync(path.resolve(__dirname, config.crd));
const crd = crdb.readCRD(data);
data = null;

exports.run = respond;

let theTimeout;
function respond(message) {
    const query = message.query;
    const fields = Object.keys(query);
    const numFields = fields.filter(f => ~NUMERIC_FIELDS.indexOf(f.toLowerCase()));

    const conditions = [];
    for (const field of numFields) {
        const lowerF = field.toLowerCase();
        let value = query[field];
        if (!Array.isArray(value)) value = [value];
        for (const condition of value) {
            const comparator = getComparator(condition);
            if (comparator == null) {
                throw new Error('wrong condition: ' + condition);
            }
            conditions.push({
                field: lowerF,
                match: comparator
            });
        }
    }

    let limit = parseInt(query.limit) || 1000;
    if (limit <= 0 || limit > 1000) limit = 1000;

    let structureSearch = null;
    if (query.searchMode && (query.smiles || query.oclid)) {
        let molQuery;
        if (query.smiles) {
            molQuery = Molecule.fromSmiles(query.smiles);
        } else if (query.oclid) {
            molQuery = Molecule.fromIDCode(query.oclid);
        }
        structureSearch = {
            mode: query.searchMode,
            query: molQuery,
            limit
        };
    }

    crd.search(conditions, structureSearch);

    let maxOK = limit;
    let minLength = Math.min(crd.length, limit);
    for (var i = 0; i < minLength; i++) {
        if (crd.molecules[i].dist === MAX_VALUE) {
            maxOK = i;
            break;
        }
    }

    const result = new Array(maxOK);
    for (var i = 0; i < maxOK; i++) {
        var mol = crd.molecules[i];
        var idx = crd.molecules[i].sortid;
        result[i] = {
            id: mol.id,
            mol: {type: 'oclid', value: mol.oclid},
            em: crd.em[idx],
            mw: crd.mw[idx],
            logp: crd.logp[idx],
            logs: crd.logs[idx],
            psa: crd.psa[idx],
            acc: crd.acc[idx],
            don: crd.don[idx],
            rot: crd.rot[idx],
            ste: crd.ste[idx]
        };
    }

    // Presort for faster next query
    if (theTimeout) {
        clearTimeout(theTimeout);
    }
    theTimeout = setTimeout(function () {
        crd.reset();
    }, 50);

    return Promise.resolve({
        content: result
    });
}

function getComparator(query) {
    var match = /([<>=]*)(\d+)/.exec(query);
    if (!match) return null;
    const value = parseFloat(match[2]);
    switch (match[1]) {
        case '':
        case '=':
        case '==':
            return comparators.eq(value);
        case '!=':
            return comparators.neq(value);
        case '<':
            return comparators.lt(value);
        case '<=':
            return comparators.lte(value);
        case '>':
            return comparators.gt(value);
        case '>=':
            return comparators.gte(value);
        default:
            return null;
    }
}
