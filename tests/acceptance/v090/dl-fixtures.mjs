// Independently specified witnesses derived from W3C Direct Semantics tables
// 3–10 and Structural Specification §§4,8,9,11. These are NOT W3C test cases.
// Expectations below are fixed before product execution; no output generates an oracle.
export const semantics='https://www.w3.org/TR/owl2-direct-semantics/';
export const syntax='https://www.w3.org/TR/owl2-syntax/';
export const prefix='Prefix(:=<urn:acceptance:dl:>)\n';
export const ontology=body=>prefix+'Ontology(\n'+body+'\n)';
export const declarations=[['Class','A B C D'],['ObjectProperty','p q r'],['DataProperty','d e'],['NamedIndividual','a b c']].flatMap(([type,names])=>names.split(' ').map(n=>'Declaration('+type+'(:'+n+'))')).join('\n');
const ca=(e,i='a')=>'ClassAssertion('+e+' :'+i+')';
const edge='ObjectPropertyAssertion(:p :a :b) ClassAssertion(:A :b)';
const value='DataPropertyAssertion(:d :a "1"^^xsd:integer)';
export const classes=[
  ['Class','SubClassOf(:B :A) '+ca(':B'),':A'],
  ['ObjectIntersectionOf',ca(':A')+' '+ca(':B'),'ObjectIntersectionOf(:A :B)'],
  ['ObjectUnionOf',ca(':A'),'ObjectUnionOf(:A :B)'],
  ['ObjectComplementOf','DisjointClasses(:A :B) '+ca(':A'),'ObjectComplementOf(:B)'],
  ['ObjectOneOf','SameIndividual(:a :b)','ObjectOneOf(:b :c)'],
  ['ObjectSomeValuesFrom',edge,'ObjectSomeValuesFrom(:p :A)'],
  ['ObjectAllValuesFrom','ObjectPropertyRange(:p :A)','ObjectAllValuesFrom(:p :A)'],
  ['ObjectHasValue',edge,'ObjectHasValue(:p :b)'],
  ['ObjectHasSelf','ObjectPropertyAssertion(:p :a :a)','ObjectHasSelf(:p)'],
  ...[false,true].flatMap(qualified=>{
    const suffix=qualified?' :A':'',mark=qualified?'Qualified':'Unqualified';
    return [['ObjectMinCardinality'+mark,edge,'ObjectMinCardinality(1 :p'+suffix+')'],
      ['ObjectMaxCardinality'+mark,'FunctionalObjectProperty(:p)','ObjectMaxCardinality(1 :p'+suffix+')'],
      ['ObjectExactCardinality'+mark,edge+' FunctionalObjectProperty(:p)','ObjectExactCardinality(1 :p'+suffix+')']];
  }),
  ['DataSomeValuesFrom',value,'DataSomeValuesFrom(:d xsd:integer)'],
  ['DataAllValuesFrom','DataPropertyRange(:d xsd:integer)','DataAllValuesFrom(:d xsd:integer)'],
  ['DataHasValue',value,'DataHasValue(:d "01"^^xsd:integer)'],
  ...[false,true].flatMap(qualified=>{
    const suffix=qualified?' xsd:integer':'',mark=qualified?'Qualified':'Unqualified';
    return [['DataMinCardinality'+mark,value,'DataMinCardinality(1 :d'+suffix+')'],
      ['DataMaxCardinality'+mark,'FunctionalDataProperty(:d)','DataMaxCardinality(1 :d'+suffix+')'],
      ['DataExactCardinality'+mark,value+' FunctionalDataProperty(:d)','DataExactCardinality(1 :d'+suffix+')']];
  })
].map(([id,body,expression])=>({id,body:declarations+'\n'+body,query:ca(expression),negative:ca('ObjectComplementOf('+expression+')'),status:'ENTAILED',basis:semantics+'#Class_Expressions'}));

export const properties=[
  ['SubObjectPropertyOf','SubObjectPropertyOf(:p :q) '+edge,'ObjectPropertyAssertion(:q :a :b)'],
  ['ObjectPropertyChain','SubObjectPropertyOf(ObjectPropertyChain(:p :q) :r) '+edge+' ObjectPropertyAssertion(:q :b :c)','ObjectPropertyAssertion(:r :a :c)'],
  ['EquivalentObjectProperties','EquivalentObjectProperties(:p :q) '+edge,'ObjectPropertyAssertion(:q :a :b)'],
  ['DisjointObjectProperties','DisjointObjectProperties(:p :q) '+edge,'NegativeObjectPropertyAssertion(:q :a :b)'],
  ['ObjectPropertyDomain','ObjectPropertyDomain(:p :A) '+edge,ca(':A')],
  ['ObjectPropertyRange','ObjectPropertyRange(:p :B) '+edge,ca(':B','b')],
  ['InverseObjectProperties','InverseObjectProperties(:p :q) '+edge,'ObjectPropertyAssertion(:q :b :a)'],
  ['FunctionalObjectProperty','FunctionalObjectProperty(:p) '+edge+' ObjectPropertyAssertion(:p :a :c)','SameIndividual(:b :c)'],
  ['InverseFunctionalObjectProperty','InverseFunctionalObjectProperty(:p) '+edge+' ObjectPropertyAssertion(:p :c :b)','SameIndividual(:a :c)'],
  ['ReflexiveObjectProperty','ReflexiveObjectProperty(:p)','ObjectPropertyAssertion(:p :a :a)'],
  ['IrreflexiveObjectProperty','IrreflexiveObjectProperty(:p)','NegativeObjectPropertyAssertion(:p :a :a)'],
  ['SymmetricObjectProperty','SymmetricObjectProperty(:p) '+edge,'ObjectPropertyAssertion(:p :b :a)'],
  ['AsymmetricObjectProperty','AsymmetricObjectProperty(:p) '+edge,'NegativeObjectPropertyAssertion(:p :b :a)'],
  ['TransitiveObjectProperty','TransitiveObjectProperty(:p) '+edge+' ObjectPropertyAssertion(:p :b :c)','ObjectPropertyAssertion(:p :a :c)'],
  ['SubDataPropertyOf','SubDataPropertyOf(:d :e) '+value,'DataPropertyAssertion(:e :a "1"^^xsd:integer)'],
  ['EquivalentDataProperties','EquivalentDataProperties(:d :e) '+value,'DataPropertyAssertion(:e :a "1"^^xsd:integer)'],
  ['DisjointDataProperties','DisjointDataProperties(:d :e) '+value,'NegativeDataPropertyAssertion(:e :a "1"^^xsd:integer)'],
  ['DataPropertyDomain','DataPropertyDomain(:d :A) '+value,ca(':A')],
  ['DataPropertyRange','DataPropertyRange(:d xsd:integer)',ca('DataAllValuesFrom(:d xsd:integer)')],
  ['FunctionalDataProperty','FunctionalDataProperty(:d)',ca('DataMaxCardinality(1 :d)')]
].map(([id,body,query])=>({id,body:declarations+'\n'+body,query,status:'ENTAILED',basis:semantics+'#Satisfaction_in_an_Interpretation'}));

// All 33 datatype names in the OWL 2 map, plus the built-in top data range.
// owl:real has no lexical space: its membership witness uses a decimal value.
export const datatypeValues=[
 ['owl:real','"1"^^xsd:decimal'],['owl:rational','"1/2"^^owl:rational'],
 ...['decimal','integer','nonNegativeInteger','positiveInteger','long','int','short','byte','unsignedLong','unsignedInt','unsignedShort','unsignedByte'].map(t=>['xsd:'+t,'"1"^^xsd:'+t]),
 ...['nonPositiveInteger','negativeInteger'].map(t=>['xsd:'+t,'"-1"^^xsd:'+t]),
 ...['double','float'].map(t=>['xsd:'+t,'"1.0"^^xsd:'+t]),
 ['rdf:PlainLiteral','"hello"@en'],
 ...['string','normalizedString','token','Name','NCName','NMTOKEN'].map(t=>['xsd:'+t,'"name"^^xsd:'+t]),
 ['xsd:language','"en"^^xsd:language'],['xsd:boolean','"true"^^xsd:boolean'],
 ['xsd:hexBinary','"01"^^xsd:hexBinary'],['xsd:base64Binary','"AQ=="^^xsd:base64Binary'],
 ['xsd:anyURI','"urn:example:a"^^xsd:anyURI'],
 ...['dateTime','dateTimeStamp'].map(t=>['xsd:'+t,'"2020-01-01T00:00:00Z"^^xsd:'+t]),
 ['rdf:XMLLiteral','"<a></a>"^^rdf:XMLLiteral'],['rdfs:Literal','"top"']
];
export const datatypes={id:'datatype-map',body:declarations+'\n'+datatypeValues.map(([t,v],i)=>'Declaration(DataProperty(:dt'+i+')) DataPropertyAssertion(:dt'+i+' :a '+v+')').join('\n'),query:datatypeValues.map(([t],i)=>ca('DataSomeValuesFrom(:dt'+i+' '+t+')')).join('\n'),status:'ENTAILED',basis:syntax+'#Datatype_Maps'};
export const dataRanges=[
 ['DataIntersectionOf','DataIntersectionOf(xsd:integer xsd:positiveInteger)'],
 ['DataUnionOf','DataUnionOf(xsd:integer xsd:string)'],
 ['DataComplementOf','DataComplementOf(xsd:string)'],
 ['DataOneOf','DataOneOf("1"^^xsd:integer "2"^^xsd:integer)'],
 ['DatatypeRestriction','DatatypeRestriction(xsd:integer xsd:minInclusive "1"^^xsd:integer xsd:maxExclusive "2"^^xsd:integer)'],
 ['DatatypeDefinition',':Small']
].map(([id,range])=>({id,body:declarations+'\n'+value+(id==='DatatypeDefinition'?' Declaration(Datatype(:Small)) DatatypeDefinition(:Small DataOneOf("1"^^xsd:integer))':''),query:ca('DataSomeValuesFrom(:d '+range+')'),status:'ENTAILED',basis:semantics+'#Data_Ranges'}));

export const restrictions=[
 ['nonsimple-cardinality','TransitiveObjectProperty(:p) SubClassOf(:A ObjectMaxCardinality(1 :p))','UseOfNonSimplePropertyInCardinalityRestriction'],
 ['nonsimple-self','TransitiveObjectProperty(:p) SubClassOf(:A ObjectHasSelf(:p))','UseOfNonSimplePropertyInObjectHasSelf'],
 ['nonsimple-functional','TransitiveObjectProperty(:p) FunctionalObjectProperty(:p)','UseOfNonSimplePropertyInFunctionalPropertyAxiom'],
 ['nonsimple-inverse-functional','TransitiveObjectProperty(:p) InverseFunctionalObjectProperty(:p)','UseOfNonSimplePropertyInInverseFunctionalObjectPropertyAxiom'],
 ['nonsimple-irreflexive','TransitiveObjectProperty(:p) IrreflexiveObjectProperty(:p)','UseOfNonSimplePropertyInIrreflexivePropertyAxiom'],
 ['nonsimple-asymmetric','TransitiveObjectProperty(:p) AsymmetricObjectProperty(:p)','UseOfNonSimplePropertyInAsymmetricObjectPropertyAxiom'],
 ['nonsimple-disjoint','TransitiveObjectProperty(:p) DisjointObjectProperties(:p :q)','UseOfNonSimplePropertyInDisjointPropertiesAxiom'],
 ['irregular-chain','SubObjectPropertyOf(ObjectPropertyChain(:p :q) :r) SubObjectPropertyOf(:r :p)','UseOfPropertyInChainCausesCycle'],
 ['cyclic-datatype','Declaration(Datatype(:T)) Declaration(Datatype(:U)) DatatypeDefinition(:T :U) DatatypeDefinition(:U :T)','CycleInDatatypeDefinition'],
 ['multiple-datatype','Declaration(Datatype(:T)) DatatypeDefinition(:T xsd:integer) DatatypeDefinition(:T xsd:string)','UseOfIllegalAxiom'],
 ['top-data-position','SubDataPropertyOf(owl:topDataProperty :d)','UseOfTopDataPropertyAsSubPropertyInSubPropertyAxiom']
].map(([id,body,violation])=>({id,body:declarations+'\n'+body,violation,basis:syntax+'#Global_Restrictions_on_Axioms_in_OWL_2_DL'}));

export const combined={id:'cross-construct',body:declarations+`\n
 Declaration(Datatype(:Small)) DatatypeDefinition(:Small DatatypeRestriction(xsd:integer xsd:minInclusive "1"^^xsd:integer))
 SubObjectPropertyOf(ObjectPropertyChain(:p :q) :r) InverseObjectProperties(:q :p)
 EquivalentClasses(:C ObjectIntersectionOf(:A ObjectSomeValuesFrom(:r :B) DataSomeValuesFrom(:d :Small)))
 ClassAssertion(:A :a) ClassAssertion(:B :c) ObjectPropertyAssertion(:p :a :b) ObjectPropertyAssertion(:q :b :c)
 DataPropertyAssertion(:d :a "1"^^xsd:integer)
 HasKey(:A () (:e)) ClassAssertion(:A :c) DataPropertyAssertion(:e :a "same") DataPropertyAssertion(:e :c "same")
`,query:'ClassAssertion(:C :a) SameIndividual(:a :c) ObjectPropertyAssertion(:r :a :c)',status:'ENTAILED',basis:semantics};
