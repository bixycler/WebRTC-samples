'use strict';

//require '../../../../js/utils.js';

//////////////////////// DOM elements \\\\\\\\\\\\\\\\\\\\\\\\

var captureStream = null; // the media stream to be captured
var mediaRecorder = null; // the media recorder
var recordChunks = []; // the chunks of recorded video
var recordedFile = document.getElementById('recordedFile');

const captureVideo = document.getElementById('captureVideo');
const playbackVideo = document.getElementById('playbackVideo');
captureVideo.addEventListener('loadedmetadata', function() {
  console.log(`Capture video: width = ${this.videoWidth}px,  height = ${this.videoHeight}px`);
});
captureVideo.addEventListener('resize', function() {
  console.log(`Capture video size changed to ${captureVideo.videoWidth}x${captureVideo.videoHeight}`);
});
playbackVideo.addEventListener('loadedmetadata', function() {
  console.log(`Playback video: width = ${this.videoWidth}px,  height: ${this.videoHeight}px`);
});

const captureButton = document.getElementById('captureButton');
const recordButton = document.getElementById('recordButton');
const recorderState = document.getElementById('recorderState');
const stopButton = document.getElementById('stopButton');
const playButton = document.getElementById('playButton');
const downloadButton = document.getElementById('downloadButton');
recordButton.disabled = true;
stopButton.disabled = true;
playButton.disabled = true;
downloadButton.disabled = true;
captureButton.addEventListener('click', startCaptureStream);
recordButton.addEventListener('click', toggleRecording);
stopButton.addEventListener('click', stopRecording);
playButton.addEventListener('click', function(){playbackVideo.play()});
downloadButton.addEventListener('click', download);

//////////////////////// Capture \\\\\\\\\\\\\\\\\\\\\\\\

async function startCaptureStream(){
  if (!captureStream) {
    let stream = await getLocalStream();
    if (stream) {
      console.log('Received capture stream:');
      captureVideo.srcObject = captureStream = stream;
    }
  }
  if (captureStream) {
    captureButton.disabled = true;
    recordButton.disabled = false;
    const videoTracks = captureStream.getVideoTracks();
    const audioTracks = captureStream.getAudioTracks();
    if (videoTracks && videoTracks.length > 0) {
      console.log(`- Video device: ${videoTracks[0].label}`);
    }
    if (audioTracks && audioTracks.length > 0) {
      console.log(`- Audio device: ${audioTracks[0].label}`);
    }
  }
}

//////////////////////// Record \\\\\\\\\\\\\\\\\\\\\\\\

function toggleRecording() {
  if(recordButton.textContent == 'Record') {
    if(!startRecording()){ 
      recorderState.innerHTML = '❌';
      return
    };
    recordButton.textContent = 'Pause';
    recorderState.innerHTML = '🔴';
    stopButton.disabled = false;
  } else {
    mediaRecorder.pause();
    recordButton.textContent = 'Record';
    recorderState.innerHTML = '⏸';
  }
}

function startRecording() {
  if(mediaRecorder){
    if(mediaRecorder.state == 'recording') return true;
    if(mediaRecorder.state == 'paused'){ mediaRecorder.resume(); return true; }
  }
  if(!mediaRecorder) try {
      mediaRecorder = new MediaRecorder(captureStream); // video/webm
  } catch (e) {
    console.log('Unable to create MediaRecorder: ', e);
    return false;
  }
  console.log('Created MediaRecorder', mediaRecorder);
  mediaRecorder.ondataavailable = function(event) {
    if (event.data && event.data.size > 0) {
      recordChunks.push(event.data);
    }
  };
  mediaRecorder.onstop = function(event){
    console.log('MediaRecorder stopped: ', event);
    const blob = new Blob(recordChunks, {type: 'video/webm'});//'video/mp4;codecs=vp9';
    playbackVideo.src = URL.createObjectURL(blob);  
    recordChunks = [];
  }
  mediaRecorder.start();
  console.log('MediaRecorder started', mediaRecorder);
  return true;
}

function stopRecording() {
  mediaRecorder.stop();
  console.log('Recorded chunks: ', recordChunks);
  recorderState.innerHTML = '▶';
  //playbackVideo.play(); //autoplay
  recordButton.textContent = 'Record';
  recordButton.disabled = true;
  stopButton.disabled = true;
  playButton.disabled = false;
  downloadButton.disabled = false;
}

function download() {
  const videoURL = playbackVideo.src;
  recordedFile.href = videoURL;
  recordedFile.download = 'record.webm';
  recordedFile.click();
  URL.revokeObjectURL(videoURL);
  recorderState.innerHTML = '';
  recordButton.textContent = 'Record';
  recordButton.disabled = false;
  stopButton.disabled = true;
  playButton.disabled = true;
  downloadButton.disabled = true;
}
