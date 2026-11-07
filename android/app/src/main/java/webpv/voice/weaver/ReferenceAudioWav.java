package webpv.voice.weaver;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** 原生解码参考录音，保留采样率与声道并写入标准 PCM WAV。 */
final class ReferenceAudioWav {
  static byte[] convert(Context context, Uri uri) throws Exception {
    MediaExtractor extractor = new MediaExtractor();
    MediaCodec decoder = null;
    try {
      extractor.setDataSource(context, uri, null);
      MediaFormat format = null;
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat candidate = extractor.getTrackFormat(i);
        String mime = candidate.getString(MediaFormat.KEY_MIME);
        if (mime != null && mime.startsWith("audio/")) {
          format = candidate; extractor.selectTrack(i); break;
        }
      }
      if (format == null) throw new IOException("未找到有效音轨");
      if (format.containsKey(MediaFormat.KEY_DURATION) && format.getLong(MediaFormat.KEY_DURATION) > 20000000L)
        throw new IOException("参考录音超过20秒限制");
      decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
      format.setInteger(MediaFormat.KEY_PCM_ENCODING, android.media.AudioFormat.ENCODING_PCM_16BIT);
      decoder.configure(format, null, null, 0); decoder.start();
      ByteArrayOutputStream pcm = new ByteArrayOutputStream();
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      boolean inputDone = false, outputDone = false;
      int rate = 0, channels = 0;
      long deadline = android.os.SystemClock.elapsedRealtime() + 30000;
      while (!outputDone) {
        if (android.os.SystemClock.elapsedRealtime() > deadline) throw new IOException("参考录音转换超时");
        if (!inputDone) {
          int index = decoder.dequeueInputBuffer(10000);
          if (index >= 0) {
            ByteBuffer input = decoder.getInputBuffer(index);
            int size = extractor.readSampleData(input, 0);
            if (size < 0) {
              decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true;
            } else {
              decoder.queueInputBuffer(index, 0, size, extractor.getSampleTime(), 0); extractor.advance();
            }
          }
        }
        int index = decoder.dequeueOutputBuffer(info, 10000);
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          MediaFormat output = decoder.getOutputFormat();
          int r = output.getInteger(MediaFormat.KEY_SAMPLE_RATE), c = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
          if (output.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
              output.getInteger(MediaFormat.KEY_PCM_ENCODING) != android.media.AudioFormat.ENCODING_PCM_16BIT)
            throw new IOException("解码器未输出16位PCM");
          if (r <= 0 || r > 192000 || c <= 0 || c > 2 || (rate != 0 && (rate != r || channels != c)))
            throw new IOException("参考录音采样格式不支持");
          rate = r; channels = c;
        } else if (index >= 0) {
          try {
            if (rate == 0) throw new IOException("缺少解码输出格式");
            if (pcm.size() + (long)info.size + 44 > 5*1024*1024 ||
                pcm.size() + (long)info.size > (long)rate*channels*2*20)
              throw new IOException("转换后的参考录音超过5MB或20秒限制");
            ByteBuffer output = decoder.getOutputBuffer(index);
            if (info.size > 0) {
              output.position(info.offset); output.limit(info.offset + info.size);
              byte[] chunk = new byte[info.size]; output.get(chunk); pcm.write(chunk);
            }
            outputDone = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
          } finally { decoder.releaseOutputBuffer(index, false); }
        }
      }
      if (pcm.size() == 0 || pcm.size() % (channels*2) != 0) throw new IOException("参考录音PCM无效");
      ByteBuffer wav = ByteBuffer.allocate(44 + pcm.size()).order(ByteOrder.LITTLE_ENDIAN);
      wav.put(new byte[]{'R','I','F','F'}).putInt(36 + pcm.size()).put(new byte[]{'W','A','V','E','f','m','t',' '});
      wav.putInt(16).putShort((short)1).putShort((short)channels).putInt(rate).putInt(rate*channels*2);
      wav.putShort((short)(channels*2)).putShort((short)16).put(new byte[]{'d','a','t','a'}).putInt(pcm.size()).put(pcm.toByteArray());
      return wav.array();
    } finally {
      if (decoder != null) decoder.release();
      extractor.release();
    }
  }
}
