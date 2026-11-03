import java.nio.ByteBuffer;
import java.util.ArrayList;

// Test-only allocation outside the Java heap. The fixture deliberately permits
// 3 GiB direct memory so the independent kernel boundary must terminate it.
class NonHeapProbe {
  public static void main(String[] args) {
    var retained = new ArrayList<ByteBuffer>();
    for (int i = 0; i < 192; i++) retained.add(ByteBuffer.allocateDirect(16 * 1024 * 1024));
    System.out.println("UNEXPECTED_ALLOCATION_SUCCESS " + retained.size());
  }
}
