export async function getWebcam(): Promise<{ videoTrack: MediaStreamTrack; audioTrack: MediaStreamTrack; stream: MediaStream }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: true,
  });

  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];

  return { videoTrack, audioTrack, stream };
}
