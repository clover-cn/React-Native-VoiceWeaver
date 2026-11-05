package webpv.voice.weaver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;

/** 独立于页面的生成任务宿主；不借用媒体播放维持执行。 */
public final class GenerationService extends HeadlessJsTaskService {
  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("generation", "听书音频生成", NotificationManager.IMPORTANCE_LOW));
    Intent open = new Intent(this, MainActivity.class);
    PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Intent cancel = new Intent(this, GenerationService.class).setAction("cancel");
    PendingIntent cancelPending = PendingIntent.getService(this, 1, cancel, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder notification = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "generation") : new Notification.Builder(this);
    startForeground(201, notification.setContentTitle("正在生成听书音频").setContentText("已完成片段自动保存，点击返回应用查看进度").setSmallIcon(android.R.drawable.ic_media_play).setContentIntent(pending).setOngoing(true).addAction(android.R.drawable.ic_menu_close_clear_cancel, "取消生成", cancelPending).build());
    if (intent != null && "cancel".equals(intent.getAction())) {
      VoiceWeaverLocal.cancelAll(); stopSelf(); return START_NOT_STICKY;
    }
    return super.onStartCommand(intent, flags, startId);
  }
  @Override protected HeadlessJsTaskConfig getTaskConfig(Intent intent) {
    return new HeadlessJsTaskConfig("VoiceWeaverGeneration", Arguments.createMap(), 0, true);
  }
  /** Android 15 后台额度耗尽时保存已完成片段并停止宿主。 */
  public void onTimeout(int startId, int foregroundServiceType) {
    VoiceWeaverLocal.cancelAll(); stopSelf();
  }
}
