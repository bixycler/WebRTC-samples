'use strict';

//require '[../../]../../js/utils.js';
//require 'offer-answer.js';

const role = 'receiver';

//////////////////////// DOM elements & Data \\\\\\\\\\\\\\\\\\\\\\\\

const startButton = document.getElementById('startButton');
const hangupButton = document.getElementById('hangupButton');
startButton.disabled = true;
hangupButton.disabled = true;
startButton.addEventListener('click', start);
hangupButton.addEventListener('click', hangup);

const sendAlso = document.getElementById('sendalso');
const recvOnly = document.getElementById('recvonly');
const sendVidres = document.getElementById('send-vidres');
const offer = document.getElementById('offer');
const answer = document.getElementById('answer');
const offerStatus = document.getElementById('offer-status');
const answerStatus = document.getElementById('answer-status');
const offerDeflated = document.getElementById('offer-deflated');
const answerDeflated = document.getElementById('answer-deflated');
const callerCandidates = document.getElementById('caller-candidates');
const receiverCandidates = document.getElementById('receiver-candidates');
const coffer = {txt:offer, but:offerStatus, deflated:offerDeflated};
const canswer = {txt:answer, but:answerStatus, deflated:answerDeflated};
sendAlso.addEventListener('change', ()=>{
  updateOnly(sendAlso,recvOnly,localVideo,sendVidres);
});
offerStatus.addEventListener('click', async()=>{
  await pasteFromClipboard(offer, offerDeflated.checked);
  updateTooltip(offerStatus,offer,'(done)', offerDeflated.checked);
});
answerStatus.addEventListener('click', async()=>{
  await copyToClipboard(answer, answerDeflated.checked);
  updateTooltip(answerStatus,answer,'(done)', answerDeflated.checked);
});
[coffer, canswer].forEach(({txt,but,deflated})=>{
  but.addEventListener('mousemove', ()=>updateTooltip(but,txt,'(done)', deflated.checked));
});
offer.addEventListener('input', ()=>{
  startButton.disabled = !offer.value.trim();
  let candidates = offer.value.match(/a=candidate:[^\r\n]*/g);
  candidates = candidates? candidates.map(m => m.substring('a='.length)): [];
  callerCandidates.value = candidates.join('\n');
  let fingerprint = offer.value.match(/a=fingerprint:[^\r\n]*/g);
  fingerprint = fingerprint? fingerprint[0].substring('a=fingerprint:'.length): '';
  console.log(`Remote peer's fingerprint: ${fingerprint}`);
  remoteHashId.innerText = fingerprint.hashCode(true);
  remoteHashId.title = 'Fingerprint:'+fingerprint;
});


//////////////////////// Action functions \\\\\\\\\\\\\\\\\\\\\\\\

async function start() {
  startButton.disabled = true;
  if(!pid){ 
    pid = await RTCPeerConnection.generateCertificate(stdRSACertificate);
    pc_config.certificates = [pid];
    let fp = pid.getFingerprints()[0], fpv = fp.algorithm+' '+fp.value.toUpperCase();
    console.log(`Id (fingerprint) of this peer: ${fpv}`);
    localHashId.innerText = fpv.hashCode(true);
    localHashId.title = 'Fingerprint:'+fpv;
  }

  // 1. Start PeerConnection
  pc = new RTCPeerConnection(pc_config);
  console.log('Created peer connection object pc with pc_config = ', pc_config);
  updateState(signst); updateState(candst); updateState(conist); updateState(connst); updateStats();
  pc.addEventListener('negotiationneeded', async function(e){
    console.log('Starting SDP negotiation'); // NEVER on a receiver!!!
  });
  pc.addEventListener('signalingstatechange', function(e){ updateState(signst); });
  pc.addEventListener('icegatheringstatechange', function(e){
    answerStatus.value = `ICE candidate ${pc.iceGatheringState}`;
    let [t,c] = collectTransports();
    let ncands = '';
    if(pc.iceGatheringState=='complete'){
      ncands = `${c.length} local candidate`+(c.length>1?'s':'');
      answerStatus.value = 'Copy Answer';
      answerStatus.disabled = false;
    }
    updateState(candst, ncands);
    updateStats();
  });
  pc.addEventListener('icecandidate', function(e){
    console.log('ICE candidate:', e.candidate ? e.candidate.candidate : null);
    answer.value = pc.localDescription.sdp; // update ICE candidates
    if(e.candidate){ receiverCandidates.value += e.candidate.candidate + '\n'; }
  });
  pc.addEventListener('iceconnectionstatechange', async function(e){
    updateState(conist);
    updateStats();
  });
  pc.addEventListener('connectionstatechange', async function(e){
    updateState(connst);
    updateStats();
  });
  pc.addEventListener('track', function(e){
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];
      console.log('pc received remote stream');
    }
  });
  // Update pc's stats periodically. Required, because both pc's stats and selected candidate pair are not up-to-date at pc & ice events
  if(statsUpdater){ clearInterval(statsUpdater); }
  statsUpdater = setInterval(updateStats, 1000, 'receiver'); // update every second

  // 1.1. Start DataChannel
  dc.local = pc.createDataChannel('Receiver-text-channel', dc_config);
  console.log('Created data channel dc.local with dc_config = ', dc_config);
  //updateState(signst); updateState(candst); updateState(conist); updateState(connst); updateStats();
  dc.local.binaryType = 'arraybuffer';
  dc.local.addEventListener('open', (e) => {
    console.log('Local channel opened.');
    dc.connected = true;
  });
  dc.local.addEventListener('close', (e) => {
    console.log('Local channel closed.');
    dc.connected = false;
  });
  dc.local.addEventListener('message', (e) => { // NEVER on a local channel!
    let msg = e.data;
    console.log('Local message received:', msg);
    localMessage.value = '< '+msg; localMessageLog.value += '< '+msg+'\n';
  });
  pc.addEventListener('datachannel', (e) => {
    console.log('Remote channel received:', e.channel);
    dc.remote = e.channel;
    dc.remote.addEventListener('open', (e) => {
      console.log('Remote channel opened.');
      dc.connected = true;
    });
    dc.remote.addEventListener('close', (e) => {
      console.log('Remote channel closed.');
      dc.connected = false;
    });
    dc.remote.addEventListener('message', (e) => {
      let msg = e.data;
      console.log('Remote message received:', msg);
      remoteMessage.value = msg; remoteMessageLog.value += msg+'\n';
    });
  });

  // 2. Set RemoteDescription
  sendAlso.disabled = true;
  console.log('pc.setRemoteDescription() start');
  try {
    await pc.setRemoteDescription({type: 'offer', sdp: offer.value});
    console.log('pc.setRemoteDescription() completed: ', pc.remoteDescription);
    console.log('Added remote stream to pc', pc.getReceivers()); //pc.getTransceivers()
    if(sendAlso.checked){
      let recvonly = (offer.value.match(/a=(sendrecv|sendonly|recvonly)/g).filter(m=>(m!='a=sendonly')).length==0);
      sendAlso.checked = !recvonly; 
      updateOnly(sendAlso,recvOnly,localVideo,sendVidres);
      if(recvonly){ console.log('Switch to "recvonly" mode');}
    }
  } catch (e) {
    handleError('pc.setRemoteDescription():', e);
    return;
  }

  // 3. Add Tracks
  if(sendAlso.checked){ await startLocalStream(); }
  if (localStream) {
    //localStream.getTracks().forEach(track => pc.addTransceiver(track, {direction: "sendrecv", streams: [localStream]}));
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream)); // REUSE transceivers created by pc.setRemoteDescription() [https://blog.mozilla.org/webrtc/rtcrtptransceiver-explored/]
    console.log('Added local stream to pc', pc.getSenders()); //pc.getTransceivers()
  }else{
    sendAlso.checked = false;
    updateOnly(sendAlso,recvOnly,localVideo,sendVidres);
    console.log('Transceivers direction = "recvonly"', pc.getTransceivers());
  }

  // 4. Set LocalDescription
  console.log('pc.setLocalDescription() start');
  try {
    await pc.setLocalDescription();
    console.log('pc.setLocalDescription() completed: ', pc.localDescription);
    answer.value = pc.localDescription.sdp; // media metadata
  } catch (e) {
    handleError('pc.setLocalDescription():', e);
    return;
  }

  // >> ICE gathering candidates [>> conntected [>> on track]]

  hangupButton.disabled = false;
}

async function hangup() {
  console.log('End call');
  pc.close(); // the "closed" state-change event will not be fired!
  // so we must update states manually
  updateState(signst); updateState(conist); updateState(connst); 
  updateStats(); collectTransports();
  pc = null; trIdBase += transports.length; transports = []; ices.clear();
  hangupButton.disabled = true;
  startButton.disabled = false;
  offer.value = '';
  answer.value = '';
  answerStatus.value = 'Waiting for Start ...';
  answerStatus.disabled = true;
  callerCandidates.value = '';
  receiverCandidates.value = '';
}


//////////////////////// Helper functions \\\\\\\\\\\\\\\\\\\\\\\\
