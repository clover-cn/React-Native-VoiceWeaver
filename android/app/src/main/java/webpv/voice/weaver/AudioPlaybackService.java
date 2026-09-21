package webpv.voice.weaver;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.io.File;
import java.lang.ref.WeakReference;
import java.util.*;
import org.json.*;

/** 媒体服务持有播放器，锁屏控制无需经 JS 重放命令。 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class AudioPlaybackService extends MediaSessionService {

  private static WeakReference<ReactApplicationContext> react =
    new WeakReference<>(null);
  private static AudioPlaybackService instance;
  private static volatile Set<String> queuedFiles = Collections.emptySet();
  private final Handler handler = new Handler(Looper.getMainLooper());
  private ExoPlayer player;
  private MediaSession session;
  private JSONArray segments = new JSONArray();
  private String chapter = "";
  private JSONObject metadata = new JSONObject();
  private int index;
  private boolean generationComplete, waiting, finished, desiredPlaying, finishedEmitted, stopped;
  private String loadedUrl = "";
  private boolean transitioning;
  private final Runnable progress = new Runnable() {
    @Override
    public void run() {
      if (player != null) emit(state());
      handler.postDelayed(this, 500);
    }
  };

  static void attach(ReactApplicationContext context) {
    react = new WeakReference<>(context);
  }

  static boolean usesFile(File file) {
    return queuedFiles.contains(Uri.fromFile(file).toString());
  }

  static void dispatch(
    ReactApplicationContext context,
    String command,
    String payload
  ) {
    attach(context);
    new Handler(Looper.getMainLooper())
      .post(() -> {
        if (instance != null) {
          instance.command(command, payload);
          return;
        }
        if (!command.equals("queue") && !command.equals("play")) return;
        try {
          context.startService(
            new Intent(context, AudioPlaybackService.class)
              .putExtra("command", command)
              .putExtra("payload", payload)
          );
        } catch (RuntimeException e) {
          emitFailure(context);
        }
      });
  }

  private static void emitFailure(ReactApplicationContext context) {
    if (!context.hasActiveCatalystInstance()) return;
    WritableMap map = Arguments.createMap();
    map.putString("state", "error");
    map.putString("chapterAssetId", "");
    map.putInt("currentIndex", 0);
    map.putInt("queueLength", 0);
    map.putDouble("positionMs", 0);
    map.putDouble("durationMs", 0);
    map.putBoolean("waitingForMoreSegments", false);
    map.putBoolean("chapterFinished", false);
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
      .emit("NovelAudioPlaybackState", map);
  }

  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    player = new ExoPlayer.Builder(this).build();
    player.setAudioAttributes(
      new AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
        .build(),
      true
    );
    player.setHandleAudioBecomingNoisy(true);
    player.setWakeMode(C.WAKE_MODE_LOCAL);
    player.addListener(
      new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int value) {
          if (transitioning) return;
          if (value == Player.STATE_ENDED) advance(); else emit(state());
        }

        @Override
        public void onPlayWhenReadyChanged(boolean play, int reason) {
          if (transitioning) return;
          desiredPlaying = play;
          emit(state());
        }

        @Override
        public void onPlayerError(PlaybackException error) {
          desiredPlaying = false;
          emit("error");
        }
      }
    );
    ForwardingPlayer controls = new ForwardingPlayer(player) {
      @Override
      public void play() {
        command("play", "");
      }

      @Override
      public void pause() {
        command("pause", "");
      }

      @Override
      public void stop() {
        command("stop", "");
      }

      @Override
      public void seekToNext() {
        command("next", "");
      }

      @Override
      public void seekToNextMediaItem() {
        command("next", "");
      }

      @Override
      public void seekToPrevious() {
        command("previous", "");
      }

      @Override
      public void seekToPreviousMediaItem() {
        command("previous", "");
      }

      @Override
      public Player.Commands getAvailableCommands() {
        return super
          .getAvailableCommands()
          .buildUpon()
          .add(Player.COMMAND_SEEK_TO_NEXT)
          .add(Player.COMMAND_SEEK_TO_PREVIOUS)
          .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
          .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
          .build();
      }

      @Override
      public boolean isCommandAvailable(int command) {
        return getAvailableCommands().contains(command);
      }
    };
    PendingIntent sessionActivity = PendingIntent.getActivity(
      this,
      0,
      new Intent(this, MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    session = new MediaSession.Builder(this, controls)
      .setSessionActivity(sessionActivity)
      .build();
    // 播放由桥接直接驱动，没有控制器绑定；必须主动注册才能生成媒体通知。
    addSession(session);
    handler.post(progress);
  }

  @Override
  public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
    return session;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int id) {
    super.onStartCommand(intent, flags, id);
    if (intent != null && intent.hasExtra("command")) command(
      intent.getStringExtra("command"),
      intent.getStringExtra("payload")
    );
    return START_NOT_STICKY;
  }

  private void command(String command, String payload) {
    try {
      switch (command) {
        case "queue":
          updateQueue(new JSONObject(payload));
          break;
        case "metadata":
          metadata = new JSONObject(payload);
          updateMetadata();
          break;
        case "play":
          desiredPlaying = true;
          stopped = false;
          if (finished) {
            index = 0;
            finished = false;
            finishedEmitted = false;
            load();
          } else if (waiting || loadedUrl.isEmpty()) load(); else {
            player.prepare();
            player.play();
          }
          break;
        case "pause":
          desiredPlaying = false;
          player.pause();
          emit("paused");
          break;
        case "stop":
          desiredPlaying = false;
          waiting = false;
          stopped = true;
          player.stop();
          emit("stopped");
          break;
        case "seek":
          player.seekTo(Math.max(0, Long.parseLong(payload)));
          emit(state());
          break;
        case "next":
          advance();
          break;
        case "previous":
          index = Math.max(0, index - 1);
          load();
          break;
        case "release":
          desiredPlaying = false;
          player.stop();
          emit("released");
          stopSelf();
          break;
        default:
          throw new IllegalArgumentException("未知播放命令");
      }
    } catch (Exception e) {
      emit("error");
    }
  }

  private void updateQueue(JSONObject queue) throws JSONException {
    String nextChapter = queue.getString("chapterAssetId");
    boolean reset =
      !nextChapter.equals(chapter) || queue.optBoolean("isExplicitStart");
    chapter = nextChapter;
    segments = queue.getJSONArray("segments");
    metadata = queue;
    generationComplete = queue.optBoolean("isGenerationComplete");
    if (queue.has("autoPlay")) desiredPlaying = queue.optBoolean("autoPlay");
    player.setPlaybackSpeed(
      (float) Math.max(0.25, Math.min(4, queue.optDouble("playbackRate", 1)))
    );
    Set<String> files = new HashSet<>();
    for (int i = 0; i < segments.length(); i++) {
      JSONObject item = segments.optJSONObject(i);
      if (item != null) files.add(item.optString("url"));
    }
    queuedFiles = Collections.unmodifiableSet(files);
    if (reset) {
      index = Math.max(0, queue.optInt("startIndex", 0));
      finished = false;
      finishedEmitted = false;
      stopped = false;
      load();
    } else if (stopped) {
      emit("stopped");
    } else if (waiting || loadedUrl.isEmpty()) load(); else {
      updateMetadata();
      player.setPlayWhenReady(desiredPlaying);
      emit(state());
    }
  }

  private void updateMetadata() {
    MediaItem current = player.getCurrentMediaItem();
    if (current != null) player.replaceMediaItem(
      0,
      current.buildUpon().setMediaMetadata(mediaMetadata()).build()
    );
  }

  private MediaMetadata mediaMetadata() {
    MediaMetadata.Builder builder = new MediaMetadata.Builder()
      .setTitle(metadata.optString("title"))
      .setArtist(metadata.optString("author"))
      .setAlbumTitle(metadata.optString("album"));
    String artwork = metadata.optString("mediaImage");
    if (!artwork.isEmpty()) builder.setArtworkUri(Uri.parse(artwork));
    return builder.build();
  }

  private void advance() {
    index++;
    load();
  }

  private void load() {
    transitioning = true;
    try {
      player.pause();
      if (index >= segments.length()) {
        if (generationComplete) {
          finished = true;
          waiting = false;
          desiredPlaying = false;
          emit("stopped");
        } else {
          waiting = true;
          emit("waiting");
        }
        return;
      }
      player.clearMediaItems();
      loadedUrl = "";
      JSONObject segment = segments.optJSONObject(index);
      String url = segment == null ? "" : segment.optString("url", "");
      if (url.isEmpty() || url.equals("null")) {
        waiting = !generationComplete;
        emit(waiting ? "waiting" : "error");
        return;
      }
      waiting = false;
      finished = false;
      loadedUrl = url;
      MediaItem item = new MediaItem.Builder()
        .setMediaId(segment.optString("id", chapter + ":" + index))
        .setUri(url)
        .setMediaMetadata(mediaMetadata())
        .build();
      player.setMediaItem(item);
      player.prepare();
      player.setPlayWhenReady(desiredPlaying);
      emit(desiredPlaying ? "loading" : "paused");
    } finally {
      transitioning = false;
    }
  }

  private String state() {
    if (finished || stopped) return "stopped";
    if (waiting) return desiredPlaying ? "waiting" : "paused";
    if (player.getPlayerError() != null) return "error";
    if (player.getPlaybackState() == Player.STATE_BUFFERING) return "loading";
    return player.getPlayWhenReady() ? "playing" : "paused";
  }

  private void emit(String state) {
    ReactApplicationContext context = react.get();
    if (context == null || !context.hasActiveCatalystInstance()) return;
    WritableMap map = Arguments.createMap();
    map.putString("state", state);
    map.putString("chapterAssetId", chapter);
    map.putInt(
      "currentIndex",
      Math.min(index, Math.max(0, segments.length() - 1))
    );
    map.putInt("queueLength", segments.length());
    map.putDouble("positionMs", Math.max(0, player.getCurrentPosition()));
    map.putDouble("durationMs", Math.max(0, player.getDuration()));
    map.putBoolean("waitingForMoreSegments", waiting);
    map.putBoolean("chapterFinished", finished && !finishedEmitted);
    if (finished) finishedEmitted = true;
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
      .emit("NovelAudioPlaybackState", map);
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    removeSession(session);
    session.release();
    player.release();
    player = null;
    instance = null;
    queuedFiles = Collections.emptySet();
    super.onDestroy();
  }
}
