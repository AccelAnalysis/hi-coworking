"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichment_link = exports.enrichment_search = void 0;
// Keep the existing audited link transaction while routing all provider searches
// through the corrected, server-only SAM.gov/USAspending implementation.
var enrichmentSearch_1 = require("./enrichmentSearch");
Object.defineProperty(exports, "enrichment_search", { enumerable: true, get: function () { return enrichmentSearch_1.enrichment_search; } });
var enrichmentLegacy_1 = require("./enrichmentLegacy");
Object.defineProperty(exports, "enrichment_link", { enumerable: true, get: function () { return enrichmentLegacy_1.enrichment_link; } });
