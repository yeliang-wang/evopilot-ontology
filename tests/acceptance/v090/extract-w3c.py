"""Extract fixed external expectations and original inputs; never infer an answer.

Acceptance-only driver. RDFLib reads RDF/XML identities/imports, not logical
consequences. No source document is rewritten or fetched through owl:imports.
"""
import argparse
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
import xml.parsers.expat as expat
from collections import Counter
from pathlib import Path

import rdflib
from rdflib import BNode, Graph, OWL, RDF, URIRef

TEST = "http://www.w3.org/2007/OWL/testOntology#"
RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
FORMATS = {"RDFXML": ("rdfxml", "rdfXml"), "FUNCTIONAL": ("functional", "fs")}
TASKS = {
    "ProfileIdentificationTest": ("legality", "legality", None),
    "ConsistencyTest": ("consistent", "consistency", None),
    "InconsistencyTest": ("inconsistent", "consistency", None),
    "PositiveEntailmentTest": ("entailed", "entailment", "ConclusionOntology"),
    "NegativeEntailmentTest": ("not-entailed", "entailment", "NonConclusionOntology"),
}


def digest(value):
    return "sha256:" + hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def values(element, key, namespace=TEST):
    return sorted(set(x.get("{" + RDF_NS + "}resource", x.text or "")
                      for x in element.findall("{" + namespace + "}" + key)))


def single(element, key):
    result = values(element, key)
    if len(result) != 1:
        raise ValueError("Expected one " + key)
    return result[0]


def xml_metadata(content, base):
    # Expat expands internal fixture entities, but refuses external declarations.
    parser = expat.ParserCreate()
    def reject(*_):
        raise ValueError("External XML content refused")
    def entity(_name, _parameter, _value, _base, system, public, _notation):
        if system or public:
            reject()
    def doctype(_name, system, public, _internal):
        if system or public:
            reject()
    parser.EntityDeclHandler = entity
    parser.StartDoctypeDeclHandler = doctype
    parser.ExternalEntityRefHandler = reject
    parser.Parse(content, True)
    graph = Graph().parse(data=content, format="xml", publicID=base)
    headers = set(graph.subjects(RDF.type, OWL.Ontology))
    # Canonical RDF mapping removes nodes used as version/import references from
    # competing header candidates. This is metadata, not an expected reasoner answer.
    referenced = set()
    for predicate in (OWL.imports, OWL.priorVersion, OWL.backwardCompatibleWith, OWL.incompatibleWith):
        referenced.update(graph.objects(None, predicate))
    candidates = headers - referenced if len(headers) > 1 else headers
    if len(candidates) > 1:
        raise ValueError("Ambiguous ontology header")
    header = next(iter(candidates), None)
    versions = list(graph.objects(header, OWL.versionIRI)) if header is not None else []
    if len(versions) > 1 or any(not isinstance(x, URIRef) for x in versions):
        raise ValueError("Ambiguous version IRI")
    imports = sorted(set(str(x) for x in graph.objects(None, OWL.imports)))
    return {"ontologyIri": str(header) if isinstance(header, URIRef) else None,
            "versionIri": str(versions[0]) if versions else None, "imports": imports}


def functional_metadata(content):
    # Tokenize strings/comments before recognizing structural header/import tokens.
    token = re.compile(r'\s+|#[^\n]*|<[^>]*>|"(?:\\.|[^"\\])*"|[()=]|[^\s()<>"#=]+')
    tokens, position = [], 0
    while position < len(content):
        match = token.match(content, position)
        if not match:
            raise ValueError("Unrecognized Functional Syntax metadata token")
        value = match.group()
        if not value.isspace() and not value.startswith("#"):
            tokens.append(value)
        position = match.end()
    prefixes, i = {}, 0
    while tokens[i] == "Prefix":
        if tokens[i + 1] != "(" or not tokens[i + 2].endswith(":") or tokens[i + 3] != "=" or tokens[i + 5] != ")":
            raise ValueError("Malformed prefix")
        prefixes[tokens[i + 2]] = tokens[i + 4][1:-1]
        i += 6
    if tokens[i:i + 2] != ["Ontology", "("]:
        raise ValueError("Missing Functional Syntax ontology")
    def iri(value):
        if value.startswith("<") and value.endswith(">"):
            return value[1:-1]
        prefix, separator, local = value.partition(":")
        if separator and prefix + ":" in prefixes:
            return prefixes[prefix + ":"] + local
        return None
    i += 2
    ontology = iri(tokens[i]); i += int(ontology is not None)
    version = iri(tokens[i]); i += int(version is not None)
    imports, depth = [], 1
    while i < len(tokens):
        if depth == 1 and tokens[i] == "Import":
            if tokens[i + 1] != "(" or tokens[i + 3] != ")" or iri(tokens[i + 2]) is None:
                raise ValueError("Malformed Functional Syntax import")
            imports.append(iri(tokens[i + 2]))
        depth += (tokens[i] == "(") - (tokens[i] == ")")
        i += 1
    if depth != 0:
        raise ValueError("Unbalanced Functional Syntax")
    return {"ontologyIri": ontology, "versionIri": version, "imports": sorted(set(imports))}


def document(content, fmt, base, identity):
    metadata = xml_metadata(content, base) if fmt == "rdfxml" else functional_metadata(content)
    return {"id": identity, "documentIri": base, "format": fmt, "content": content,
            "digest": digest(content), "ontologyIri": metadata["ontologyIri"],
            "versionIri": metadata["versionIri"]}, metadata["imports"]


def extract(archive, lock):
    raw = Path(archive).read_bytes()
    if len(raw) != lock["bytes"] or digest(raw) != "sha256:" + lock["sha256"]:
        raise ValueError("Archive differs from pinned W3C source")
    elements = list(ET.fromstring(raw))
    support = {}
    for element in elements:
        iris = values(element, "importedOntologyIRI")
        for iri in iris:
            for syntax, (fmt, prefix) in FORMATS.items():
                contents = values(element, prefix + "InputOntology")
                if contents:
                    if len(contents) != 1:
                        raise ValueError("Ambiguous imported fixture")
                    key = (iri, fmt)
                    if key in support and support[key] != contents[0]:
                        raise ValueError("Conflicting imported fixture bytes")
                    support[key] = contents[0]
    cases, jobs, counts = [], [], Counter()
    for element in elements:
        if not all(TEST + value in values(element, field) for field, value in lock["selection"].items()):
            continue
        case = single(element, "identifier")
        if case in cases:
            raise ValueError("Duplicate selected case")
        cases.append(case)
        types = [x.removeprefix(TEST) for x in values(element, "type", RDF_NS)]
        if set(types) - TASKS.keys():
            raise ValueError("Unmapped test type")
        for syntax_iri in values(element, "normativeSyntax"):
            syntax = syntax_iri.removeprefix(TEST)
            if syntax not in FORMATS:
                raise ValueError("Unmapped normative serialization: " + syntax)
            fmt, prefix = FORMATS[syntax]
            counts[fmt] += 1
            content = single(element, prefix + "PremiseOntology")
            closure, extraction_error = None, None
            try:
                base = "https://evopilot.invalid/w3c/" + digest(case)[7:] + "/premise"
                matching_imports = [iri for (iri, form), text in support.items() if form == fmt and text == content]
                if len(matching_imports) == 1:
                    base = matching_imports[0]
                root, imports = document(content, fmt, base, "root")
                docs, edges, pending = [root], [], [(root, imports)]
                by_alias = {x: root for x in (root["documentIri"], root["ontologyIri"], root["versionIri"]) if x}
                # Cyclic imports are pinned from the archive, never fetched.
                while pending:
                    parent, declarations = pending.pop(0)
                    for iri in declarations:
                        target = by_alias.get(iri)
                        if target is None:
                            imported = support.get((iri, fmt))
                            if imported is None:
                                raise ValueError("Missing pinned imported fixture " + iri)
                            target, nested = document(imported, fmt, iri, "import-" + str(len(docs)))
                            for alias in (target["documentIri"], target["ontologyIri"], target["versionIri"]):
                                if alias:
                                    if alias in by_alias and by_alias[alias] is not target:
                                        raise ValueError("Conflicting imported ontology alias")
                                    by_alias[alias] = target
                            docs.append(target); pending.append((target, nested))
                        edges.append({"from": parent["id"], "iri": iri, "to": target["id"]})
                closure = {"rootDocumentId": "root", "documents": docs, "imports": edges}
            except Exception as error:
                extraction_error = {"code": "EXTRACTION_FAILED", "detail": str(error)}
            for test_type in sorted(types):
                expected, kind, query_role = TASKS[test_type]
                task = {"kind": kind}
                if query_role:
                    query = single(element, prefix + query_role)
                    task["query"] = {"format": fmt, "content": query, "digest": digest(query)}
                identity = digest(case + "\n" + fmt + "\n" + test_type)[7:]
                jobs.append({"id": identity, "case": case, "format": fmt, "type": test_type,
                             "expected": expected, "premiseDigest": digest(content),
                             "extractionError": extraction_error,
                             "request": {"schema": "ontology-dl-request/v1", "requestId": "w3c-" + identity,
                                         "closure": closure, "task": task}})
    expected_counts = dict(Counter(x["expected"] for x in jobs))
    if (len(cases) != lock["caseCount"] or dict(counts) != lock["serializationCounts"]
            or len(jobs) != lock["jobCount"] or expected_counts != lock["expectedCounts"]):
        raise ValueError("Selection/count drift from fixed corpus")
    return {"schema": "ontology-w3c-extracted/v1", "source": lock, "cases": sorted(cases),
            "extractor": {"sha256": digest(Path(__file__).read_bytes()), "python": sys.version,
                          "rdflib": rdflib.__version__}, "jobs": sorted(jobs, key=lambda x: (x["case"], x["format"], x["type"]))}


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("--archive", required=True)
    args.add_argument("--lock", required=True)
    parsed = args.parse_args()
    print(json.dumps(extract(parsed.archive, json.loads(Path(parsed.lock).read_text())), ensure_ascii=False))
