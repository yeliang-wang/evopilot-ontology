"""Bounded RDFLib projection only; no inference, network imports, writes or decisions."""
import json
import sys
from rdflib import Graph, URIRef, BNode, Literal, RDFS
from rdflib.compare import to_canonical_graph


def term(value):
    if isinstance(value, URIRef):
        return {"kind": "iri", "value": str(value)}
    if isinstance(value, BNode):
        return {"kind": "blank", "value": str(value)}
    if isinstance(value, Literal):
        return {"kind": "literal", "value": str(value), "datatype": str(value.datatype) if value.datatype else None, "language": value.language}
    raise ValueError("Unsupported RDF term")


def main():
    raw = sys.stdin.buffer.read(33554433)
    if len(raw) > 33554432:
        raise ValueError("Input limit")
    data = json.loads(raw)
    if set(data) != {"graphs"} or not isinstance(data["graphs"], list) or len(data["graphs"]) > 200:
        raise ValueError("Graph manifest")
    result, total = [], 0
    for item in data["graphs"]:
        if set(item) != {"path", "content", "role"}:
            raise ValueError("Graph fields")
        graph = Graph()
        graph.parse(data=item["content"], format="turtle")
        total += len(graph)
        if total > 20000:
            raise ValueError("Triple limit")
        canonical = to_canonical_graph(graph)
        triples = sorted([[term(s), term(p), term(o)] for s, p, o in canonical], key=lambda t: json.dumps(t, sort_keys=True, ensure_ascii=False))
        result.append({"path": item["path"], "role": item["role"], "triples": triples})
    sys.stdout.write(json.dumps({"graphs": result, "total": total}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("RDF projection failed\n")
        sys.exit(1)
