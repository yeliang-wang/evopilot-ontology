// Acceptance-only format conversion; not an Ontology product capability.
// Its closed input is retained explanation output or a separately attributed
// original Functional Syntax/normative acceptance fixture. No imports allowed.
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.HashSet;
import java.io.ByteArrayOutputStream;
import org.semanticweb.owlapi.apibinding.OWLManager;
import org.semanticweb.owlapi.formats.RDFXMLDocumentFormat;
import org.semanticweb.owlapi.functional.parser.OWLFunctionalSyntaxOWLParserFactory;
import org.semanticweb.owlapi.io.StringDocumentSource;
import org.semanticweb.owlapi.model.OWLOntology;
import org.semanticweb.owlapi.model.OWLSameIndividualAxiom;

class ReplayConvert {
  // W3C Mapping to RDF, Table 1: an n-ary SameIndividual is serialized as
  // adjacent binary equalities. Normalize that specified representation before
  // the strict round-trip comparison; all other logical axioms stay exact.
  static int splitIndividualEqualities(OWLOntology ontology) {
    var manager=ontology.getOWLOntologyManager();
    var factory=manager.getOWLDataFactory();
    int expanded=0;
    for(var axiom:List.copyOf(ontology.getLogicalAxioms())) {
      if(!(axiom instanceof OWLSameIndividualAxiom same)) continue;
      var individuals=same.individuals().sorted().toList();
      if(individuals.size()<=2) continue;
      manager.removeAxiom(ontology,same);
      for(int i=1;i<individuals.size();i++) manager.addAxiom(ontology,
        factory.getOWLSameIndividualAxiom(List.of(individuals.get(i-1),individuals.get(i)),same.getAnnotations()));
      expanded++;
    }
    return expanded;
  }
  static void requireLogicalEquality(OWLOntology expected,OWLOntology actual) {
    if(!new HashSet<>(expected.getLogicalAxioms()).equals(new HashSet<>(actual.getLogicalAxioms())))
      throw new IllegalStateException("Serialization changed logical axioms");
  }
  public static void main(String[] args) throws Exception {
    if(args.length!=2) throw new IllegalArgumentException("input and output required");
    String text=Files.readString(Path.of(args[0]));
    if(text.contains("Import(")) throw new IllegalArgumentException("Replay imports forbidden");
    var manager=OWLManager.createOWLOntologyManager();
    manager.getOntologyParsers().set(List.of(new OWLFunctionalSyntaxOWLParserFactory()));
    var ontology=manager.loadOntologyFromOntologyDocument(new StringDocumentSource(text));
    if(!ontology.getImportsDeclarations().isEmpty()) throw new IllegalArgumentException("Replay must be closed");
    var inputAxiomCount=ontology.getAxiomCount();
    var inputLogicalAxiomCount=ontology.getLogicalAxiomCount();
    var expanded=splitIndividualEqualities(ontology);
    var bytes=new ByteArrayOutputStream();
    manager.saveOntology(ontology,new RDFXMLDocumentFormat(),bytes);
    var second=OWLManager.createOWLOntologyManager().loadOntologyFromOntologyDocument(new StringDocumentSource(bytes.toString(java.nio.charset.StandardCharsets.UTF_8)));
    requireLogicalEquality(ontology,second);
    Files.write(Path.of(args[1]),bytes.toByteArray());
    System.out.println("{\"logicalAxiomsEqual\":true,\"inputAxiomCount\":"+inputAxiomCount+",\"outputAxiomCount\":"+second.getAxiomCount()+",\"logicalAxiomCount\":"+inputLogicalAxiomCount+",\"normalizedLogicalAxiomCount\":"+ontology.getLogicalAxiomCount()+",\"expandedSameIndividualAxioms\":"+expanded+",\"normalizationBasis\":\"https://www.w3.org/TR/owl2-mapping-to-rdf/#Translation_of_Axioms_without_Annotations\"}");
  }
}
