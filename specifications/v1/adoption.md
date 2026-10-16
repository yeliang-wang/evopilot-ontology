# Standard adoption

Generated from `support-matrix.json`; tests compare this table to the same index. SUPPORTED applies only to native language behavior, not project acceptance.

| ID | Standard / clause | Status | Adopted meaning and limits | Tests |
|---|---|---|---|---|
| rdf-turtle | [RDF 1.1 / Turtle 1.1](https://www.w3.org/TR/turtle/) / RDF graphs and Turtle | SUPPORTED | UTF-8 Turtle only; graph set semantics, stable business IRIs | O01, O04, O10 |
| rdfs-owl-declarations | [RDFS 1.1 / OWL 2 2012](https://www.w3.org/TR/owl2-overview/) / Named declarations | RESTRICTED | Declared classes/properties/labels/comments/domain/range/subclass/subproperty only; inference none; no OWL consistency or inferred facts | O02, O07 |
| core-value-type | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-value-type) / 4.1 | SUPPORTED | class, datatype, nodeKind | O02, O04 |
| core-cardinality | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-count) / 4.2 | SUPPORTED | minCount/maxCount; duplicate triples do not represent multiple events | O04 |
| core-range | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-range) / 4.3 | SUPPORTED | min/max Exclusive/Inclusive | O02 |
| core-string | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-string) / 4.4 | SUPPORTED | min/maxLength, pattern/flags, languageIn, uniqueLang | O02 |
| core-property-pair | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-property-pairs) / 4.5 | SUPPORTED | equals/disjoint/lessThan/lessThanOrEquals | O03 |
| core-logical | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-logical) / 4.6 | SUPPORTED | and/or/not/xone, non-recursive shapes | O03, O07 |
| core-shape | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-shape) / 4.7 | RESTRICTED | node and qualifiedValueShape/counts; recursion refused | O03, O07 |
| core-other | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#core-components-other) / 4.8 | SUPPORTED | closed/ignoredProperties, hasValue, in | O02, O03 |
| targets-paths | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#targets) / 2.1.3, 2.3 | RESTRICTED | Core targets/paths; fixed root targetNode, expected IDs/types and required shapes; no focus or shape subset selection | O05, O06 |
| sparql | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#sparql-constraints) / 5 | RESTRICTED | Local SELECT only; no SERVICE/FROM/GRAPH/VALUES/MINUS/Update/custom functions | O08, O09 |
| meta | [SHACL 2017 plus EvoPilot adoption](https://www.w3.org/TR/2017/REC-shacl-20170720/#shapes-graph) / Shapes graph | RESTRICTED | meta-SHACL plus executable-vocabulary/recursion checks and EvoPilot required declaration metadata | O07 |
| extensions | [SHACL-JS / SHACL-AF / custom components](https://www.w3.org/TR/shacl-af/) / Not adopted | UNSUPPORTED | No executable extensions, external imports, recursion, RDF-star or multi named graphs | O07, O08 |
| scope-bindings | [EvoPilot convention](https://github.com/yeliang-wang/evopilot-ontology) / Project closure | SUPPORTED | Independent requirements, expected identities, shapes and case IDs; source status and namespace ownership | O03, O05, O06, O12 |
| report | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/#validation-report) / 3.6 | SUPPORTED | Native raw graph; code/report agreement; required Warning/Info fail; timeout/errors never conform | O10, O11 |
