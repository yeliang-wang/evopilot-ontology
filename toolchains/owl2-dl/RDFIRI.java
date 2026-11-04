/* EvoPilot RDF identifier syntax and resolution. No network or scheme policy.
 * RFC 3987 sections 2.2 and 6.5; RFC 3986 sections 3.2.2 and 5.2.
 * Written for the owned parser adapters; not an upstream OWLAPI replacement. */
package org.semanticweb.owlapi.rdf.turtle.parser;

/** Generic IRI-reference grammar and strict base resolution. Identifiers are
 * never percent-decoded, repaired, Unicode-normalized or case-normalized. */
public final class RDFIRI {
    private RDFIRI() {}

    public static final class Syntax extends RuntimeException {
        public Syntax(String message) { super(message); }
    }

    private record Parts(String scheme, String authority, String path,
            String query, String fragment) {}

    public static void validateReference(String value) { parse(value); }

    /** An absolute RDF IRI (scheme required, fragment allowed), rather than the
     * narrower RFC 3987 production named absolute-IRI. */
    public static void validateAbsolute(String value) {
        if (parse(value).scheme() == null) throw new Syntax("RDF IRI requires a scheme");
    }

    /** RFC 3986 5.2 strict algorithm, applied directly to IRI characters per
     * RFC 3987 6.5. A base fragment is ignored; an empty component is retained. */
    public static String resolve(String reference, String absoluteBase) {
        Parts r = parse(reference), b = parse(absoluteBase);
        if (b.scheme() == null) throw new Syntax("IRI base requires a scheme");
        String scheme, authority, path, query;
        if (r.scheme() != null) {
            scheme = r.scheme(); authority = r.authority();
            path = removeDotSegments(r.path()); query = r.query();
        } else {
            scheme = b.scheme();
            if (r.authority() != null) {
                authority = r.authority(); path = removeDotSegments(r.path()); query = r.query();
            } else {
                authority = b.authority();
                if (r.path().isEmpty()) {
                    path = b.path(); query = r.query() == null ? b.query() : r.query();
                } else {
                    String merged = r.path();
                    if (!merged.startsWith("/")) {
                        merged = b.authority() != null && b.path().isEmpty() ? "/" + merged
                                : b.path().substring(0, b.path().lastIndexOf('/') + 1) + merged;
                    }
                    path = removeDotSegments(merged); query = r.query();
                }
            }
        }
        StringBuilder out = new StringBuilder(scheme).append(':');
        if (authority != null) out.append("//").append(authority);
        out.append(path);
        if (query != null) out.append('?').append(query);
        if (r.fragment() != null) out.append('#').append(r.fragment());
        return out.toString();
    }

    // For already validated adapter inputs; package-private to avoid a second
    // public interpretation API. A scheme ends before any path/query/fragment.
    static boolean hasScheme(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == ':') return true;
            if (c == '/' || c == '?' || c == '#') return false;
        }
        return false;
    }

    private static Parts parse(String value) {
        if (value == null) throw new Syntax("IRI reference is null");
        int length = value.length(), hash = value.indexOf('#');
        int end = hash < 0 ? length : hash;
        String fragment = hash < 0 ? null : value.substring(hash + 1);
        if (fragment != null) characters(fragment, 3);
        int question = value.indexOf('?');
        if (question >= end) question = -1;
        String query = question < 0 ? null : value.substring(question + 1, end);
        if (query != null) characters(query, 2);
        if (question >= 0) end = question;
        String scheme = null, authority = null;
        int start = 0, colon = value.indexOf(':'), slash = value.indexOf('/');
        if (colon >= 0 && colon < end && (slash < 0 || colon < slash)) {
            if (colon == 0 || !alpha(value.charAt(0))) throw new Syntax("Invalid IRI scheme or relative first segment");
            for (int i = 1; i < colon; i++) {
                char c = value.charAt(i);
                if (!alpha(c) && !digit(c) && c != '+' && c != '-' && c != '.')
                    throw new Syntax("Invalid IRI scheme or relative first segment");
            }
            scheme = value.substring(0, colon); start = colon + 1;
        }
        if (start + 1 < end && value.charAt(start) == '/' && value.charAt(start + 1) == '/') {
            int boundary = value.indexOf('/', start + 2);
            if (boundary < 0 || boundary > end) boundary = end;
            authority = value.substring(start + 2, boundary); authority(authority); start = boundary;
        }
        String path = value.substring(start, end);
        // Authority consumes //; all remaining alternatives are ipath-absolute,
        // rootless/noscheme, or empty. A noscheme first colon was rejected above.
        characters(path, 1);
        return new Parts(scheme, authority, path, query, fragment);
    }

    private static void authority(String value) {
        int at = value.indexOf('@');
        if (at >= 0) { characters(value.substring(0, at), 4); value = value.substring(at + 1); }
        String port = null;
        if (value.startsWith("[")) {
            int close = value.indexOf(']');
            if (close < 0) throw new Syntax("Unclosed IRI IP literal");
            ipLiteral(value.substring(1, close));
            if (close + 1 < value.length()) {
                if (value.charAt(close + 1) != ':') throw new Syntax("Invalid IRI authority suffix");
                port = value.substring(close + 2);
            }
        } else {
            int colon = value.indexOf(':');
            if (colon >= 0) { port = value.substring(colon + 1); value = value.substring(0, colon); }
            // IPv4-looking strings can also be legal registered names. Generic
            // syntax is deliberately independent of DNS, TLD and HTTP policy.
            characters(value, 0);
        }
        if (port != null) for (int i = 0; i < port.length(); i++)
            if (!digit(port.charAt(i))) throw new Syntax("IRI port must contain ASCII digits");
    }

    private static void ipLiteral(String value) {
        if (!value.isEmpty() && (value.charAt(0) == 'v' || value.charAt(0) == 'V')) {
            int dot = value.indexOf('.');
            if (dot < 2 || dot == value.length() - 1) throw new Syntax("Invalid IPvFuture literal");
            for (int i = 1; i < dot; i++) if (!hex(value.charAt(i))) throw new Syntax("Invalid IPvFuture version");
            for (int i = dot + 1; i < value.length(); i++) {
                char c = value.charAt(i);
                if (!(asciiUnreserved(c) || subDelimiter(c) || c == ':')) throw new Syntax("Invalid IPvFuture address");
            }
            return;
        }
        int compression = value.indexOf("::");
        if (compression >= 0 && value.indexOf("::", compression + 2) >= 0)
            throw new Syntax("Multiple IPv6 compressions");
        int groups;
        if (compression < 0) {
            groups = ipv6Groups(value, true);
            if (groups != 8) throw new Syntax("IPv6 requires eight groups");
        } else {
            String left = value.substring(0, compression), right = value.substring(compression + 2);
            // An embedded IPv4 address is the final ls32, never before ::.
            groups = (left.isEmpty() ? 0 : ipv6Groups(left, false))
                    + (right.isEmpty() ? 0 : ipv6Groups(right, true));
            if (groups >= 8) throw new Syntax("IPv6 compression must replace at least one group");
        }
    }

    private static int ipv6Groups(String value, boolean ipv4Allowed) {
        int groups = 0, start = 0;
        while (true) {
            int end = value.indexOf(':', start);
            if (end < 0) end = value.length();
            int size = end - start;
            if (size < 1) throw new Syntax("Empty uncompressed IPv6 group");
            String part = value.substring(start, end);
            if (part.indexOf('.') >= 0) {
                if (!ipv4Allowed || end != value.length()) throw new Syntax("Misplaced embedded IPv4 address");
                ipv4(part); groups += 2;
            } else {
                if (size > 4) throw new Syntax("Oversized IPv6 group");
                for (int i = start; i < end; i++) if (!hex(value.charAt(i))) throw new Syntax("Invalid IPv6 group");
                groups++;
            }
            if (groups > 8) throw new Syntax("Too many IPv6 groups");
            if (end == value.length()) return groups;
            start = end + 1;
        }
    }

    private static void ipv4(String value) {
        int start = 0;
        for (int index = 0; index < 4; index++) {
            int end = value.indexOf('.', start);
            if (index == 3 ? end >= 0 : end < 0) throw new Syntax("Invalid embedded IPv4 address");
            if (end < 0) end = value.length();
            int length = end - start;
            if (length < 1 || length > 3 || length > 1 && value.charAt(start) == '0')
                throw new Syntax("Invalid embedded IPv4 octet");
            int number = 0;
            for (int i = start; i < end; i++) {
                char c = value.charAt(i);
                if (!digit(c)) throw new Syntax("Invalid embedded IPv4 digit");
                number = number * 10 + c - '0';
            }
            if (number > 255) throw new Syntax("Embedded IPv4 octet exceeds 255");
            start = end + 1;
        }
    }

    // 0=ireg-name, 1=ipath, 2=iquery, 3=ifragment, 4=iuserinfo.
    private static void characters(String value, int component) {
        for (int i = 0; i < value.length();) {
            int cp = value.codePointAt(i); i += Character.charCount(cp);
            if (cp == '%') {
                if (i + 1 >= value.length() || !hex(value.charAt(i)) || !hex(value.charAt(i + 1)))
                    throw new Syntax("Malformed IRI percent triplet");
                i += 2; continue;
            }
            if (asciiUnreserved(cp) || ucschar(cp) || subDelimiter(cp)) continue;
            if (cp == ':' && component != 0 || cp == '@' && component >= 1 && component <= 3) continue;
            if (cp == '/' && component >= 1 && component <= 3 || cp == '?' && (component == 2 || component == 3)) continue;
            if (component == 2 && iprivate(cp)) continue;
            throw new Syntax("Invalid character in IRI component " + component);
        }
    }

    private static boolean alpha(int c) { return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'; }
    private static boolean digit(int c) { return c >= '0' && c <= '9'; }
    private static boolean hex(int c) { return digit(c) || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'; }
    private static boolean asciiUnreserved(int c) { return alpha(c) || digit(c) || c == '-' || c == '.' || c == '_' || c == '~'; }
    private static boolean subDelimiter(int c) { return c < 128 && "!$&'()*+,;=".indexOf(c) >= 0; }
    private static boolean ucschar(int c) {
        return c >= 0xA0 && c <= 0xD7FF || c >= 0xF900 && c <= 0xFDCF || c >= 0xFDF0 && c <= 0xFFEF
                || c >= 0x10000 && c <= 0xDFFFD && (c & 0xFFFF) <= 0xFFFD || c >= 0xE1000 && c <= 0xEFFFD;
    }
    private static boolean iprivate(int c) {
        return c >= 0xE000 && c <= 0xF8FF || c >= 0xF0000 && c <= 0xFFFFD || c >= 0x100000 && c <= 0x10FFFD;
    }

    private static void removeLastSegment(StringBuilder out) {
        int slash = out.lastIndexOf("/"); out.setLength(slash < 0 ? 0 : slash);
    }

    private static String removeDotSegments(String path) {
        StringBuilder out = new StringBuilder(path.length());
        int i = 0, n = path.length();
        while (i < n) {
            if (path.startsWith("../", i)) i += 3;
            else if (path.startsWith("./", i)) i += 2;
            else if (path.startsWith("/./", i)) i += 2;
            else if (path.startsWith("/.", i) && i + 2 == n) { out.append('/'); i = n; }
            else if (path.startsWith("/../", i)) { i += 3; removeLastSegment(out); }
            else if (path.startsWith("/..", i) && i + 3 == n) { removeLastSegment(out); out.append('/'); i = n; }
            else if (path.startsWith(".", i) && i + 1 == n || path.startsWith("..", i) && i + 2 == n) i = n;
            else {
                int next = path.indexOf('/', path.charAt(i) == '/' ? i + 1 : i);
                if (next < 0) next = n;
                out.append(path, i, next); i = next;
            }
        }
        return out.toString();
    }
}
