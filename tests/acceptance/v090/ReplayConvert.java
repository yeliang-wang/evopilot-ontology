// Acceptance-only format conversion; not an Ontology product capability.
// Its input is retained native explanation output, never an external ontology.
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.HashSet;
import java.io.ByteArrayOutputStream;
import org.semanticweb.owlapi.apibinding.OWLManager;
import org.semanticweb.owlapi.formats.RDFXMLDocumentFormat;
import org.semanticweb.owlapi.functional.parser.OWLFunctionalSyntaxOWLParserFactory;
import org.semanticweb.owlapi.io.StringDocumentSource;

class ReplayConvert {
  public static void main(String[] args) throws Exception {
    if(args.length!=2) throw new IllegalArgumentException("input and output required");
    String text=Files.readString(Path.of(args[0]));
    if(text.contains("Import(")) throw new IllegalArgumentException("Replay imports forbidden");
    var manager=OWLManager.createOWLOntologyManager();
    manager.getOntologyParsers().set(List.of(new OWLFunctionalSyntaxOWLParserFactory()));
    var ontology=manager.loadOntologyFromOntologyDocument(new StringDocumentSource(text));
    if(!ontology.getImportsDeclarations().isEmpty()) throw new IllegalArgumentException("Replay must be closed");
    var bytes=new ByteArrayOutputStream();
    manager.saveOntology(ontology,new RDFXMLDocumentFormat(),bytes);
    var second=OWLManager.createOWLOntologyManager().loadOntologyFromOntologyDocument(new StringDocumentSource(bytes.toString(java.nio.charset.StandardCharsets.UTF_8)));
    if(!new HashSet<>(ontology.getLogicalAxioms()).equals(new HashSet<>(second.getLogicalAxioms()))) throw new IllegalStateException("Serialization changed logical axioms");
    Files.write(Path.of(args[1]),bytes.toByteArray());
    System.out.println("Logical axiom equality verified across replay serialization");
  }
}
