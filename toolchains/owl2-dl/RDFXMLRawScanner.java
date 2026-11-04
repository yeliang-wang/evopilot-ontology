package org.semanticweb.owlapi.rdf.rdfxml.parser;

import java.util.*;

/** Original-input lexical index. Mature XML providers remain the grammar/SAX
 * authority; every indexed element/attribute/text is reconciled with its actual
 * SAX event. No line locator, serializer, or RDF-text heuristic supplies spans. */
final class RDFXMLRawScanner {
    static final int MAX_EXPANDED_UTF16 = 32 * 1024 * 1024;
    static final String XML = "http://www.w3.org/XML/1998/namespace";
    final LocatedRDFXMLParser.Store store;
    final String original;
    final Map<String, Entity> entities = new LinkedHashMap<>();
    final Map<String, Entity> parameters = new LinkedHashMap<>();
    final Map<String, LinkedHashMap<String, AttributeDecl>> declarations = new LinkedHashMap<>();
    final ArrayList<Node> preorder = new ArrayList<>();
    int expansions, expandedUnits;

    record Piece(int from, int to, int rawStart, int rawEnd, boolean linear,
                 List<Integer> contexts) {}
    final class Text {
        final String value;
        final List<Piece> pieces;
        Text(String value, List<Piece> pieces) {
            this.value = value; this.pieces = List.copyOf(pieces);
            store.records(1); store.references(pieces.size());
            if (value.length() > MAX_EXPANDED_UTF16) limit("Expanded XML UTF-16 code-unit budget");
        }
        Text slice(int start, int end) {
            if (start < 0 || end < start || end > value.length()) bad("Invalid lexical slice");
            ArrayList<Piece> result = new ArrayList<>();
            for (Piece p : pieces) {
                int a = Math.max(start, p.from), b = Math.min(end, p.to);
                if (a >= b) continue;
                result.add(new Piece(a-start,b-start,p.linear?p.rawStart+a-p.from:p.rawStart,
                        p.linear?p.rawStart+b-p.from:p.rawEnd,p.linear,p.contexts));
            }
            return new Text(value.substring(start,end),result);
        }
        Text context(int id) {
            return new Text(value,pieces.stream().map(p -> new Piece(p.from,p.to,p.rawStart,p.rawEnd,
                    p.linear,merge(p.contexts,List.of(id)))).toList());
        }
        int sources(String kind, int start, int end) {
            TreeSet<Integer> ids = new TreeSet<>();
            for (Piece p : pieces) {
                int a=Math.max(start,p.from),b=Math.min(end,p.to);
                if(a<b) ids.add(store.source(kind,p.linear?p.rawStart+a-p.from:p.rawStart,
                        p.linear?p.rawStart+b-p.from:p.rawEnd));
            }
            if(ids.isEmpty())bad("An XML source has no original characters");
            return store.set(ids);
        }
        List<Integer> contexts(int start, int end) {
            TreeSet<Integer> ids=new TreeSet<>();
            for(Piece p:pieces)if(Math.max(start,p.from)<Math.min(end,p.to))ids.addAll(p.contexts);
            return List.copyOf(ids);
        }
    }
    final class Builder {
        final StringBuilder text = new StringBuilder();
        final ArrayList<Piece> pieces = new ArrayList<>();
        void add(Text t) {
            int offset=text.length();
            if((long)offset+t.value.length()>MAX_EXPANDED_UTF16)limit("Expanded XML UTF-16 code-unit budget");
            text.append(t.value);
            for(Piece p:t.pieces)pieces.add(new Piece(offset+p.from,offset+p.to,p.rawStart,p.rawEnd,p.linear,p.contexts));
        }
        Text finish(){return new Text(text.toString(),pieces);}
    }
    final class Entity {
        final String name;
        final Text body;
        final int context;
        Entity(String name,Text body,int context){this.name=name;this.body=body;this.context=context;store.records(1);}
    }
    final class AttributeDecl {
        final String element,name,type;
        final Text value;
        final int context,sourceSet;
        Text expanded;
        AttributeDecl(String element,String name,String type,Text value,int context,int sourceSet){
            this.element=element;this.name=name;this.type=type;this.value=value;this.context=context;this.sourceSet=sourceSet;store.records(1);
        }
    }
    static final class Attribute {
        final String name,value,type;
        final int sourceSet;
        final List<Integer> contexts;
        final boolean defaulted;
        Attribute(String name,String value,String type,int set,List<Integer> contexts,boolean defaulted){
            this.name=name;this.value=value;this.type=type;this.sourceSet=set;this.contexts=List.copyOf(contexts);this.defaulted=defaulted;
        }
    }
    final class Node {
        final Text input;
        final int start,nameStart,nameEnd;
        int end;
        final String qname;
        final Node parent;
        final LinkedHashMap<String,Attribute> attributes=new LinkedHashMap<>();
        final ArrayList<Node> children=new ArrayList<>();
        final ArrayList<Integer> textSources=new ArrayList<>();
        final TreeSet<Integer> textContexts=new TreeSet<>();
        final StringBuilder textValue=new StringBuilder();
        Node(Text input,int start,int a,int b,Node parent){this.input=input;this.start=start;nameStart=a;nameEnd=b;qname=input.value.substring(a,b);this.parent=parent;store.records(1);}
        int elementSource(){return input.sources("ELEMENT",start,end);}
        int nameSource(){return input.sources("ELEMENT_NAME",nameStart,nameEnd);}
        List<Integer> inheritedContexts(){return input.contexts(nameStart,nameEnd);}
    }
    final class Cursor {
        final Text input;int pos;
        Cursor(Text input){this.input=input;}
        boolean end(){return pos>=input.value.length();}
        boolean at(String s){return input.value.startsWith(s,pos);}
        void ws(){while(!end()&&space(input.value.charAt(pos)))pos++;store.check();}
        void require(String s){if(!at(s))bad("Expected XML lexical token "+s);pos+=s.length();}
        String name(){int a=pos;while(!end()&&!space(input.value.charAt(pos))&&"/=><[]()?|%;\"'".indexOf(input.value.charAt(pos))<0)pos++;if(pos==a)bad("Missing XML name");return input.value.substring(a,pos);}
        Text quoted(){if(end()||(input.value.charAt(pos)!='\''&&input.value.charAt(pos)!='\"'))bad("Missing XML quoted value");char quote=input.value.charAt(pos++);int a=pos;while(!end()&&input.value.charAt(pos)!=quote)pos++;if(end())bad("Unclosed XML quoted value");Text result=input.slice(a,pos);pos++;return result;}
    }

    RDFXMLRawScanner(String content,LocatedRDFXMLParser.Store store){
        this.store=store;original=content;expandedUnits=content.length();
        Text root=new Text(content,List.of(new Piece(0,content.length(),0,content.length(),true,List.of())));
        // XML 1.0 section 2.11 applies once to the external input, before
        // entity/character-reference expansion. Replacement text is not a new
        // external input: a CR introduced by &#xD; must remain a CR in text.
        Cursor c=new Cursor(normalizeExternalLines(root));if(c.at("\uFEFF"))c.pos++;
        scan(c,null,0,true,new ArrayDeque<>());
        if(preorder.isEmpty())bad("XML has no indexed root element");
    }
    static boolean space(char c){return c==' '||c=='\t'||c=='\r'||c=='\n';}
    static List<Integer> merge(Collection<Integer> a,Collection<Integer> b){TreeSet<Integer> values=new TreeSet<>(a);values.addAll(b);return List.copyOf(values);}
    static void bad(String message){throw new LocatedRDFXMLParser.MappingException(message);}
    static void limit(String message){throw new LocatedRDFXMLParser.LimitException(message);}
    Text transformed(Text original,String value,List<Integer> contexts){
        if(original.pieces.isEmpty()&&value.isEmpty())return original;
        ArrayList<Piece> pieces=new ArrayList<>();
        for(Piece p:original.pieces)pieces.add(new Piece(0,value.length(),p.rawStart,p.rawEnd,false,merge(p.contexts,contexts)));
        return new Text(value,pieces);
    }
    Text normalizeExternalLines(Text value){
        Builder result=new Builder();int begin=0;
        for(int i=0;i<value.value.length();i++){
            char c=value.value.charAt(i);
            if(c=='\r'){
                if(begin<i)result.add(value.slice(begin,i));int end=i+1;
                if(c=='\r'&&end<value.value.length()&&value.value.charAt(end)=='\n')end++;
                result.add(transformed(value.slice(i,end),"\n",List.of()));i=end-1;begin=end;
            }
        }
        if(begin<value.value.length())result.add(value.slice(begin,value.value.length()));
        return result.finish();
    }
    Text normalizeLines(Text value,boolean attribute){
        if(!attribute)return value;
        Builder result=new Builder();int begin=0;
        // Section 3.3.3: whitespace in entity replacement values contributes
        // one space per character. Character references handled by value()
        // bypass this step; a replacement CR followed by LF is two spaces.
        for(int i=0;i<value.value.length();i++)if(value.value.charAt(i)=='\r'||value.value.charAt(i)=='\n'||value.value.charAt(i)=='\t'){
            if(begin<i)result.add(value.slice(begin,i));result.add(transformed(value.slice(i,i+1)," ",List.of()));begin=i+1;
        }
        if(begin<value.value.length())result.add(value.slice(begin,value.value.length()));return result.finish();
    }
    int referenceContext(Text reference,String name,Integer declaration){
        List<Integer> deps=reference.contexts(0,reference.value.length());if(declaration!=null)deps=merge(deps,List.of(declaration));
        return store.context("ENTITY_REFERENCE",name,null,reference.sources("ENTITY_REFERENCE",0,reference.value.length()),deps);
    }
    Text replacement(Entity entity,Text reference,Deque<String> active,String key){
        if(active.contains(key))bad("Recursive XML entity");
        if(++expansions>1000)limit("XML entity expansion budget");
        expandedUnits+=entity.body.value.length();if(expandedUnits>MAX_EXPANDED_UTF16)limit("Expanded XML UTF-16 code-unit budget");
        return entity.body.context(referenceContext(reference,key,entity.context));
    }
    String scalar(String reference){
        try{int radix=reference.startsWith("#x")?16:10;String digits=reference.substring(radix==16?2:1);if(digits.isEmpty())bad("Empty XML character reference");
            for(char c:digits.toCharArray())if(radix==16?!(c>='0'&&c<='9'||c>='a'&&c<='f'||c>='A'&&c<='F'):!(c>='0'&&c<='9'))bad("Invalid XML character reference");
            int cp=Integer.parseInt(digits,radix);if(!(cp==9||cp==10||cp==13||cp>=0x20&&cp<=0xD7FF||cp>=0xE000&&cp<=0xFFFD||cp>=0x10000&&cp<=0x10FFFF))bad("Invalid XML character scalar");return new String(Character.toChars(cp));
        }catch(IllegalArgumentException e){bad("Invalid XML character reference");return null;}
    }
    Text value(Text input,boolean attribute,boolean declaration,Deque<String> active){
        Builder out=new Builder();int begin=0;
        for(int i=0;i<input.value.length();i++)if(input.value.charAt(i)=='&'){
            int stop=input.value.indexOf(';',i+1);if(stop<0)bad("Unclosed XML entity reference");String name=input.value.substring(i+1,stop);
            if(declaration&&!name.startsWith("#")){i=stop;continue;}
            if(begin<i)out.add(normalizeLines(input.slice(begin,i),attribute));Text ref=input.slice(i,stop+1);
            String builtin=switch(name){case "lt"->"<";case "gt"->">";case "amp"->"&";case "apos"->"'";case "quot"->"\"";default->null;};
            if(name.startsWith("#")||builtin!=null){String decoded=name.startsWith("#")?scalar(name):builtin;int ctx=referenceContext(ref,name,null);out.add(transformed(ref,decoded,List.of(ctx)));}
            else{Entity entity=entities.get(name);if(entity==null)bad("Undeclared XML general entity");Text expanded=replacement(entity,ref,active,name);active.push(name);out.add(value(expanded,attribute,false,active));active.pop();}
            i=stop;begin=stop+1;
        }
        if(begin<input.value.length())out.add(normalizeLines(input.slice(begin,input.value.length()),attribute));
        return out.finish();
    }
    void scan(Cursor c,Node parent,int depth,boolean document,Deque<String> active){
        while(!c.end()){
            store.check();
            if(c.at("</")){if(parent==null)bad("Unexpected XML closing tag");return;}
            if(c.at("<!--")){int end=c.input.value.indexOf("-->",c.pos+4);if(end<0)bad("Unclosed XML comment");c.pos=end+3;continue;}
            if(c.at("<?")){int end=c.input.value.indexOf("?>",c.pos+2);if(end<0)bad("Unclosed XML processing instruction");c.pos=end+2;continue;}
            if(c.at("<!DOCTYPE")){if(!document||parent!=null)bad("Unexpected XML doctype");doctype(c);continue;}
            if(c.at("<![CDATA[")){
                if(parent==null)bad("CDATA outside XML root");int begin=c.pos,end=c.input.value.indexOf("]]>",begin+9);if(end<0)bad("Unclosed CDATA");
                Text raw=c.input.slice(begin+9,end);Text decoded=normalizeLines(raw,false);parent.textValue.append(decoded.value);
                parent.textSources.add(c.input.sources("CDATA",begin,end+3));parent.textContexts.addAll(c.input.contexts(begin,end+3));c.pos=end+3;continue;
            }
            if(c.at("<")){element(c,parent,depth,active);continue;}
            if(c.at("&")){
                if(parent==null)bad("Entity outside XML root");int begin=c.pos,end=c.input.value.indexOf(';',begin+1);if(end<0)bad("Unclosed XML reference");String name=c.input.value.substring(begin+1,end);Text ref=c.input.slice(begin,end+1);c.pos=end+1;
                if(name.startsWith("#")||Set.of("lt","gt","amp","apos","quot").contains(name)){
                    Text decoded=value(ref,false,false,active);text(parent,decoded,ref.sources("TEXT",0,ref.value.length()));
                }else{Entity entity=entities.get(name);if(entity==null)bad("Undeclared XML general entity");Text expanded=replacement(entity,ref,active,name);active.push(name);Cursor nested=new Cursor(expanded);scan(nested,parent,depth,false,active);active.pop();if(!nested.end())bad("Entity markup crosses its replacement boundary");}
                continue;
            }
            int begin=c.pos;while(!c.end()&&!c.at("<")&&!c.at("&"))c.pos++;
            Text raw=c.input.slice(begin,c.pos),decoded=normalizeLines(raw,false);
            if(parent!=null)text(parent,decoded,raw.sources("TEXT",0,raw.value.length()));
            else if(!decoded.value.isBlank())bad("Text outside XML root");
        }
    }
    void text(Node node,Text value,int sources){node.textValue.append(value.value);node.textSources.add(sources);node.textContexts.addAll(value.contexts(0,value.value.length()));store.references(1);}
    void element(Cursor c,Node parent,int depth,Deque<String> active){
        if(depth>=256)limit("XML depth budget");int start=c.pos;c.require("<");int a=c.pos;String name=c.name();int b=c.pos;
        Node node=new Node(c.input,start,a,b,parent);preorder.add(node);if(parent!=null)parent.children.add(node);
        for(;;){c.ws();if(c.at("/>")||c.at(">"))break;int attrStart=c.pos;String attributeName=c.name();c.ws();c.require("=");c.ws();Text raw=c.quoted();int attrEnd=c.pos;
            AttributeDecl decl=declarations.getOrDefault(name,new LinkedHashMap<>()).get(attributeName);
            Text decoded=value(raw,true,false,active);String type=decl==null?"CDATA":decl.type;
            String normalized=attributeValue(decoded.value,type);List<Integer> contexts=merge(c.input.contexts(attrStart,attrEnd),decoded.contexts(0,decoded.value.length()));
            if(decl!=null)contexts=merge(contexts,List.of(decl.context));
            Attribute attr=new Attribute(attributeName,normalized,type,c.input.sources(attributeKind(attributeName),attrStart,attrEnd),contexts,false);
            if(node.attributes.putIfAbsent(attributeName,attr)!=null)bad("Duplicate original XML attribute");store.records(1);
        }
        for(AttributeDecl decl:declarations.getOrDefault(name,new LinkedHashMap<>()).values())if(!node.attributes.containsKey(decl.name)&&decl.value!=null){
            if(decl.expanded==null)decl.expanded=value(decl.value,true,false,new ArrayDeque<>());
            List<Integer> dependencies=merge(List.of(decl.context),decl.expanded.contexts(0,decl.expanded.value.length()));
            int ctx=store.context("DTD_ATTRIBUTE_DEFAULT",name+"@"+decl.name,attributeValue(decl.expanded.value,decl.type),decl.sourceSet,dependencies);
            node.attributes.put(decl.name,new Attribute(decl.name,attributeValue(decl.expanded.value,decl.type),decl.type,decl.sourceSet,List.of(ctx),true));store.records(1);
        }
        if(c.at("/>")){c.pos+=2;node.end=c.pos;return;}
        c.require(">");scan(c,node,depth+1,false,active);c.require("</");String close=c.name();if(!close.equals(name))bad("Mismatched original XML closing name");c.ws();c.require(">");node.end=c.pos;
    }
    static String attributeValue(String value,String type){return type.equals("CDATA")?value:value.replaceAll(" +"," ").replaceAll("^ | $","");}
    static String attributeKind(String name){return name.equals("xmlns")||name.startsWith("xmlns:")?"NAMESPACE":name.equals("xml:base")?"XML_BASE":name.equals("xml:lang")?"XML_LANG":"ATTRIBUTE";}
    void doctype(Cursor c){
        c.require("<!DOCTYPE");c.ws();c.name();c.ws();
        if(c.at("SYSTEM")||c.at("PUBLIC"))bad("External XML doctype is forbidden");
        if(c.at("[")){
            int begin=++c.pos;char quote=0;
            while(!c.end()){
                char ch=c.input.value.charAt(c.pos);
                if(quote!=0){if(ch==quote)quote=0;c.pos++;continue;}
                if(ch=='\''||ch=='\"'){quote=ch;c.pos++;continue;}
                if(c.at("<!--")){int end=c.input.value.indexOf("-->",c.pos+4);if(end<0)bad("Unclosed DTD comment");c.pos=end+3;continue;}
                if(ch==']')break;c.pos++;
            }
            if(c.end())bad("Unclosed internal DTD");dtd(new Cursor(c.input.slice(begin,c.pos)),new ArrayDeque<>());c.pos++;c.ws();
        }
        c.require(">");
    }
    void dtd(Cursor c,Deque<String> active){
        while(!c.end()){
            c.ws();if(c.end())return;
            if(c.at("<!--")){int end=c.input.value.indexOf("-->",c.pos+4);if(end<0)bad("Unclosed DTD comment");c.pos=end+3;continue;}
            if(c.at("<?")){int end=c.input.value.indexOf("?>",c.pos+2);if(end<0)bad("Unclosed DTD processing instruction");c.pos=end+2;continue;}
            if(c.at("%")){
                int begin=c.pos++;String name=c.name();c.require(";");Entity entity=parameters.get(name);if(entity==null)bad("Undeclared XML parameter entity");Text ref=c.input.slice(begin,c.pos);Text expanded=replacement(entity,ref,active,"%"+name);active.push("%"+name);dtd(new Cursor(expanded),active);active.pop();continue;
            }
            int begin=c.pos;c.require("<!");String kind=c.name();
            if(kind.equals("ENTITY")){
                c.ws();boolean parameter=c.at("%");if(parameter){c.pos++;c.ws();}String name=c.name();c.ws();
                if(c.at("SYSTEM")||c.at("PUBLIC"))bad("External XML entity is forbidden");Text raw=c.quoted();c.ws();c.require(">");
                int set=c.input.sources("ENTITY_DECLARATION",begin,c.pos),ctx=store.context("ENTITY_DECLARATION",parameter?"%"+name:name,null,set,c.input.contexts(begin,c.pos));
                Text body=value(raw,false,true,active);(parameter?parameters:entities).putIfAbsent(name,new Entity(name,body,ctx));
            }else if(kind.equals("ATTLIST")){
                c.ws();String element=c.name();
                while(true){c.ws();if(c.at(">")){c.pos++;break;}int attrStart=c.pos;String name=c.name();c.ws();String type;
                    if(c.at("(")){int start=c.pos;while(!c.end()&&!c.at(")"))c.pos++;c.require(")");type=c.input.value.substring(start,c.pos);}
                    else{type=c.name();if(type.equals("NOTATION")){c.ws();c.require("(");while(!c.end()&&!c.at(")"))c.pos++;c.require(")");}}
                    c.ws();Text val=null;if(c.at("#REQUIRED"))c.pos+=9;else if(c.at("#IMPLIED"))c.pos+=8;else{if(c.at("#FIXED")){c.pos+=6;c.ws();}val=c.quoted();}
                    // Include the ATTLIST's element name: it is the grammar fact
                    // binding this attribute/default to the actual element.
                    int set=c.input.sources("DTD_ATTRIBUTE_DECLARATION",begin,c.pos),ctx=store.context("DTD_ATTRIBUTE_DECLARATION",element+"@"+name,type,set,c.input.contexts(begin,c.pos));
                    declarations.computeIfAbsent(element,k->new LinkedHashMap<>()).putIfAbsent(name,new AttributeDecl(element,name,type,val,ctx,set));
                }
            }else if(kind.equals("ELEMENT")||kind.equals("NOTATION")){
                char quote=0;while(!c.end()){char ch=c.input.value.charAt(c.pos++);if(quote!=0){if(ch==quote)quote=0;}else if(ch=='\''||ch=='\"')quote=ch;else if(ch=='>')break;}if(c.end()&&!c.input.value.endsWith(">"))bad("Unclosed DTD declaration");
            }else bad("Unsupported or malformed internal DTD declaration");
        }
    }
}
