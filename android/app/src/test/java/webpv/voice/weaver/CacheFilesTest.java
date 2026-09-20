package webpv.voice.weaver;

import static org.junit.Assert.*;

import java.io.File;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class CacheFilesTest {

  @Rule
  public TemporaryFolder temporary = new TemporaryFolder();

  @Test
  public void acceptsOnlyDirectChildren() throws Exception {
    File cache = temporary.newFolder("audio");
    assertTrue(CacheFiles.isOwnedChild(cache, new File(cache, "track")));
    assertFalse(CacheFiles.isOwnedChild(cache, cache));
    assertFalse(
      CacheFiles.isOwnedChild(cache, new File(cache, "nested/track"))
    );
  }

  @Test
  public void rejectsTraversalAndPrefixSibling() throws Exception {
    File cache = temporary.newFolder("audio");
    assertFalse(
      CacheFiles.isOwnedChild(cache, new File(cache, "../private-book"))
    );
    assertFalse(
      CacheFiles.isOwnedChild(
        cache,
        new File(temporary.getRoot(), "audio-other/track")
      )
    );
  }
}
