package io.evopilot.ontology;

import dk.brics.automaton.Automaton;
import dk.brics.automaton.BasicAutomata;
import dk.brics.automaton.BasicOperations;
import java.util.*;
import java.util.function.IntPredicate;

/** XSD 1.1 Appendix G regular languages over XML 1.0 Fifth Edition code points.
 * Automata encode supplementary characters as UTF-16 pairs, but each character
 * class/repetition denotes one Unicode code point. No Java/brics regex syntax
 * is substituted for the XSD grammar. Unicode categories/blocks use the pinned
 * Java 21 Unicode 15.0 database. This adapter has no product state or authority.
 */
public final class XmlSchemaAutomata {
  private XmlSchemaAutomata(){}
  public static final class Syntax extends IllegalArgumentException {Syntax(String message){super(message);}}
  public static final class ResourceLimit extends RuntimeException {ResourceLimit(String message){super(message);}}
  static final int MAX_POINT=0x10FFFF,MAX_STATES=50000,MAX_TRANSITIONS=200000,MAX_QUANTITY=10000;
  static final BitSet XML=set(c->xmlCharacter(c));
  static final BitSet START=set(c->nameStart(c));
  static final BitSet NAME=set(c->nameCharacter(c));
  static final Map<String,BitSet> CATEGORIES=new LinkedHashMap<>();
  static final Map<String,Automaton> PATTERNS=new LinkedHashMap<>();
  static final Set<String> UNKNOWN_BLOCKS=new TreeSet<>();
  static final Map<Integer,String> TYPES=Map.ofEntries(
    Map.entry(0,"Cn"),Map.entry(1,"Lu"),Map.entry(2,"Ll"),Map.entry(3,"Lt"),Map.entry(4,"Lm"),Map.entry(5,"Lo"),
    Map.entry(6,"Mn"),Map.entry(7,"Me"),Map.entry(8,"Mc"),Map.entry(9,"Nd"),Map.entry(10,"Nl"),Map.entry(11,"No"),
    Map.entry(12,"Zs"),Map.entry(13,"Zl"),Map.entry(14,"Zp"),Map.entry(15,"Cc"),Map.entry(16,"Cf"),Map.entry(18,"Co"),
    Map.entry(19,"Cs"),Map.entry(20,"Pd"),Map.entry(21,"Ps"),Map.entry(22,"Pe"),Map.entry(23,"Pc"),Map.entry(24,"Po"),
    Map.entry(25,"Sm"),Map.entry(26,"Sc"),Map.entry(27,"Sk"),Map.entry(28,"So"),Map.entry(29,"Pi"),Map.entry(30,"Pf"));
  public static boolean between(int c,int low,int high){return c>=low&&c<=high;}
  public static boolean xmlCharacter(int c){return c==9||c==10||c==13||between(c,0x20,0xD7FF)||between(c,0xE000,0xFFFD)||between(c,0x10000,MAX_POINT);}
  public static boolean nameStart(int c){
    return c==':'||c=='_'||between(c,'A','Z')||between(c,'a','z')||between(c,0xC0,0xD6)||between(c,0xD8,0xF6)
      ||between(c,0xF8,0x2FF)||between(c,0x370,0x37D)||between(c,0x37F,0x1FFF)||between(c,0x200C,0x200D)
      ||between(c,0x2070,0x218F)||between(c,0x2C00,0x2FEF)||between(c,0x3001,0xD7FF)||between(c,0xF900,0xFDCF)
      ||between(c,0xFDF0,0xFFFD)||between(c,0x10000,0xEFFFF);
  }
  public static boolean nameCharacter(int c){return nameStart(c)||c=='-'||c=='.'||between(c,'0','9')||c==0xB7||between(c,0x300,0x36F)||between(c,0x203F,0x2040);}
  static BitSet set(IntPredicate predicate){var result=new BitSet(MAX_POINT+1);for(int c=0;c<=MAX_POINT;c++)if(predicate.test(c))result.set(c);return result;}
  static BitSet copy(BitSet set){return (BitSet)set.clone();}
  static BitSet singleton(int c){var s=new BitSet();s.set(c);return s;}
  static BitSet complement(BitSet set){var result=copy(XML);result.andNot(set);return result;}
  static Automaton bounded(Automaton a){
    if(a.getNumberOfStates()>MAX_STATES||a.getNumberOfTransitions()>MAX_TRANSITIONS)throw new ResourceLimit("XSD regular-language state budget exceeded");return a;
  }
  static Automaton chars(BitSet values){
    var allowed=copy(values);allowed.and(XML);var parts=new ArrayList<Automaton>();
    for(int start=allowed.nextSetBit(0);start>=0;){int end=allowed.nextClearBit(start)-1;range(parts,start,end);start=allowed.nextSetBit(end+1);}
    var result=parts.isEmpty()?BasicAutomata.makeEmpty():BasicOperations.union(parts);
    // Factor shared surrogate prefixes before repetition. Leaving the union
    // as an NFA creates a quadratic transition fan-out for ordinary \p{L}+.
    result.determinize();result.minimize();return bounded(result);
  }
  static void range(List<Automaton> parts,int start,int end){
    if(start<=0xFFFF){parts.add(BasicAutomata.makeCharRange((char)start,(char)Math.min(end,0xFFFF)));start=0x10000;}
    if(start>end)return;
    int first=(start-0x10000)/1024+0xD800,last=(end-0x10000)/1024+0xD800;
    int low=(start-0x10000)%1024+0xDC00,high=(end-0x10000)%1024+0xDC00;
    if(first==last){parts.add(BasicAutomata.makeChar((char)first).concatenate(BasicAutomata.makeCharRange((char)low,(char)high)));return;}
    parts.add(BasicAutomata.makeChar((char)first).concatenate(BasicAutomata.makeCharRange((char)low,'\uDFFF')));
    if(first+1<last)parts.add(BasicAutomata.makeCharRange((char)(first+1),(char)(last-1)).concatenate(BasicAutomata.makeCharRange('\uDC00','\uDFFF')));
    parts.add(BasicAutomata.makeChar((char)last).concatenate(BasicAutomata.makeCharRange('\uDC00',(char)high)));
  }
  public static Automaton xmlChar(){return chars(XML);}
  public static Automaton name(boolean nonColon){var start=copy(START);var rest=copy(NAME);if(nonColon){start.clear(':');rest.clear(':');}return chars(start).concatenate(chars(rest).repeat());}
  public static Automaton nmtoken(){return chars(NAME).repeat(1);}
  public static Automaton normalizedString(){var s=copy(XML);s.clear(9);s.clear(10);s.clear(13);return chars(s).repeat();}
  public static Automaton token(){var s=copy(XML);for(int c:new int[]{9,10,13,32})s.clear(c);var word=chars(s).repeat(1);return word.concatenate(BasicAutomata.makeChar(' ').concatenate(word).repeat()).optional();}
  public static List<String> unknownBlocks(){return List.copyOf(UNKNOWN_BLOCKS);}
  static String blockKey(String name){return name.replaceAll("[^A-Za-z0-9]","").toUpperCase(Locale.ROOT);}
  static BitSet category(String name,boolean negative){
    if(name.matches("Is[A-Za-z0-9-]+")){
      String key=blockKey(name.substring(2));
      if(key.equals("COMBININGMARKSFORSYMBOLS"))key="COMBININGDIACRITICALMARKSFORSYMBOLS";
      if(key.equals("GREEKANDCOPTIC"))key="GREEK";
      final String wanted=key;BitSet found=CATEGORIES.get(name);
      if(found==null){
        var matches=new HashMap<Character.UnicodeBlock,Boolean>();
        found=set(c->{var block=Character.UnicodeBlock.of(c);return block!=null&&matches.computeIfAbsent(block,b->blockKey(b.toString()).equals(wanted));});
        if(found.isEmpty()){
          // XSD 1.1 G.4.2.4: both p and P for unknown block names denote
          // all characters by default. Surface the observation to the caller.
          if(UNKNOWN_BLOCKS.size()>=128&&!UNKNOWN_BLOCKS.contains(name))throw new ResourceLimit("Unknown Unicode block diagnostic budget exceeded");
          UNKNOWN_BLOCKS.add(name);return copy(XML);
        }
        if(CATEGORIES.size()<128)CATEGORIES.put(name,found);
      }
      return negative?complement(found):copy(found);
    }
    if(!name.matches("L[ultmo]?|M[nce]?|N[dlo]?|P[cdseifo]?|Z[slp]?|S[mcko]?|C[cfon]?"))throw new Syntax("Unknown XSD Unicode category");
    BitSet found=CATEGORIES.get(name);
    if(found==null){found=set(c->TYPES.get(Character.getType(c)).startsWith(name));if(CATEGORIES.size()<128)CATEGORIES.put(name,found);}
    return negative?complement(found):copy(found);
  }
  public static Automaton pattern(String source){
    if(source.length()>65536)throw new ResourceLimit("XSD regex text budget exceeded");
    var cached=PATTERNS.get(source);if(cached!=null)return cached.clone();
    var p=new Parser(source);var result=p.expression();if(p.index!=source.length())throw p.error("Unexpected regex token");
    result=bounded(result);if(PATTERNS.size()<16)PATTERNS.put(source,result.clone());return result;
  }
  record Glyph(BitSet values,Integer single,boolean rawHyphen){}
  static final class Parser {
    final String source;int index=0,depth=0;
    Parser(String source){this.source=source;}
    Syntax error(String message){return new Syntax(message+" at UTF-16 offset "+index);}
    int peek(){return index==source.length()?-1:source.codePointAt(index);}
    int take(){int c=peek();if(c<0)throw error("Unexpected regex end");index+=Character.charCount(c);if(!xmlCharacter(c))throw error("Non-XML character in regex");return c;}
    boolean eat(int c){if(peek()!=c)return false;take();return true;}
    void need(int c){if(!eat(c))throw error("Expected regex delimiter");}
    void enter(){if(++depth>128)throw new ResourceLimit("XSD regex nesting budget exceeded");}
    Automaton expression(){enter();var branches=new ArrayList<Automaton>();branches.add(branch());while(eat('|'))branches.add(branch());depth--;return bounded(BasicOperations.union(branches));}
    Automaton branch(){var result=BasicAutomata.makeEmptyString();while(peek()>=0&&peek()!=')'&&peek()!='|')result=bounded(result.concatenate(piece()));return result;}
    Automaton piece(){
      Automaton a=atom();if(eat('?'))return bounded(a.optional());if(eat('*'))return bounded(a.repeat());if(eat('+'))return bounded(a.repeat(1));
      if(!eat('{'))return a;int min=quantity(),max=min;if(eat(','))max=peek()=='}'?-1:quantity();need('}');
      if(max>=0&&max<min)throw error("Reversed regex quantity");
      if((long)Math.max(min,max)*a.getNumberOfStates()>MAX_STATES)throw new ResourceLimit("XSD quantified automaton budget exceeded");
      return bounded(max<0?a.repeat(min):a.repeat(min,max));
    }
    int quantity(){
      if(peek()<'0'||peek()>'9')throw error("Missing regex quantity");int n=0;
      while(peek()>='0'&&peek()<='9'){n=n*10+(take()-'0');if(n>MAX_QUANTITY)throw new ResourceLimit("XSD regex quantity budget exceeded");}return n;
    }
    Automaton atom(){
      if(eat('(')){var a=expression();need(')');return a;}
      if(peek()=='[')return chars(group());
      if(eat('.')){var s=copy(XML);s.clear(10);s.clear(13);return chars(s);}
      if(eat('\\'))return chars(escape().values());
      if(peek()<0||".?*+{}()|[]".indexOf(peek())>=0)throw error("Unexpected regex metacharacter");
      return BasicAutomata.makeString(new String(Character.toChars(take())));
    }
    Glyph escape(){
      int c=take();
      if(c=='n'||c=='r'||c=='t'){int value=c=='n'?10:c=='r'?13:9;return new Glyph(singleton(value),value,false);}
      if("\\|.?*+(){}-[]^".indexOf(c)>=0)return new Glyph(singleton(c),c,false);
      if(c=='p'||c=='P'){need('{');int begin=index;while(peek()>=0&&peek()!='}')take();String name=source.substring(begin,index);need('}');return new Glyph(category(name,c=='P'),null,false);}
      boolean negative=Character.isUpperCase(c);BitSet s;
      switch(Character.toLowerCase(c)){
        case 's':s=new BitSet();for(int v:new int[]{32,9,10,13})s.set(v);break;
        case 'i':s=copy(START);break;case 'c':s=copy(NAME);break;
        case 'd':s=category("Nd",false);break;
        case 'w':s=category("P",false);s.or(category("Z",false));s.or(category("C",false));s=complement(s);break;
        default:throw error("Unknown XSD character escape");
      }
      return new Glyph(negative?complement(s):s,null,false);
    }
    Glyph glyph(){if(eat('\\'))return escape();int c=take();if(c=='['||c==']')throw error("Unescaped class delimiter");return new Glyph(singleton(c),c,c=='-');}
    BitSet group(){
      enter();need('[');boolean negative=eat('^');var values=new BitSet();int parts=0;
      while(peek()>=0&&peek()!=']'&&!source.startsWith("-[",index)){
        Glyph a=glyph();parts++;
        if(a.single()!=null&&peek()=='-'&&!source.startsWith("-[",index)&&!source.startsWith("-]",index)&&!source.startsWith("--[",index)){
          take();Glyph b=glyph();if(a.rawHyphen()||b.rawHyphen()||b.single()==null||a.single()>b.single())throw error("Invalid XSD character range");
          values.set(a.single(),b.single()+1);
          if(peek()=='-'&&!source.startsWith("-[",index)&&!source.startsWith("-]",index)&&!source.startsWith("--[",index))throw error("Overlapping XSD range delimiter");
        }else values.or(a.values());
      }
      if(parts==0)throw error("Empty XSD character group");if(negative)values=complement(values);
      if(eat('-')){if(peek()!='[')throw error("Invalid XSD class subtraction");values.andNot(group());}
      need(']');depth--;return values;
    }
  }
}
