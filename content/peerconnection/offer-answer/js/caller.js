'use strict';

//require '[../../]../../js/utils.js';
//require 'offer-answer.js';

const role = 'caller';

//////////////////////// DOM elements & Data \\\\\\\\\\\\\\\\\\\\\\\\

const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
callButton.disabled = true;
hangupButton.disabled = true;
startButton.addEventListener('click', start);
callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);

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
offerStatus.addEventListener('click', async()=>{
  await copyToClipboard(offer, offerDeflated.checked);
  updateTooltip(offerStatus,offer,'(done)', offerDeflated.checked);
});
answerStatus.addEventListener('click', async()=>{
  await pasteFromClipboard(answer, answerDeflated.checked);
  updateTooltip(answerStatus,answer,'(done)', answerDeflated.checked);
});
[coffer, canswer].forEach(({txt,but,deflated})=>{
  but.addEventListener('mousemove', ()=>updateTooltip(but,txt,'(done)', deflated.checked));
});
answer.addEventListener('input', ()=>{
  callButton.disabled = !answer.value.trim();
  let candidates = answer.value.match(/a=candidate:[^\r\n]*/g);
  candidates = candidates? candidates.map(m => m.substring('a='.length)): [];
  receiverCandidates.value = candidates.join('\n');
  let fingerprint = answer.value.match(/a=fingerprint:[^\r\n]*/g);
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

  // 0. Start UserMedia
  await startLocalStream();

  // 1. Start PeerConnection
  pc = new RTCPeerConnection(pc_config);
  console.log('Created peer connection object pc with pc_config = ', pc_config);
  updateState(signst); updateState(candst); updateState(conist); updateState(connst); updateStats();
  pc.addEventListener('negotiationneeded', async function(e){
    console.log('Starting SDP negotiation');
    // The following pc.setLocalDescription(offer) can be put right after pc.addTrack(), or right after pc.createDataChannel() if there's no media track.
    // But here we put it in event 'negotiationneeded' just to be on the safe side.
    // 3. Set LocalDescription
    console.log('pc.setLocalDescription() start');
    try {
      const sender = await pc.setLocalDescription();
      console.log('pc.setLocalDescription() completed: ', pc.localDescription);
      offer.value = pc.localDescription.sdp; // media metadata
    } catch (e) {
      handleError('pc.setLocalDescription():', e);
      return;
    }
  });
  pc.addEventListener('signalingstatechange', function(e){ updateState(signst); updateStats();});
  pc.addEventListener('icegatheringstatechange', function(e){
    offerStatus.value = `ICE candidate ${pc.iceGatheringState}`;
    let [t,c] = collectTransports();
    let ncands = '';
    if(pc.iceGatheringState=='complete'){
      ncands = `${c.length} local candidate`+(c.length>1?'s':'');
      offerStatus.value = 'Copy Offer';
      offerStatus.disabled = false;
      answerStatus.value = 'Paste Answer';
      answerStatus.disabled = false;
    }
    updateState(candst, ncands);
    updateStats();
  });
  pc.addEventListener('icecandidate', function(e){
    console.log('ICE candidate:', e.candidate ? e.candidate.candidate : null);
    offer.value = pc.localDescription.sdp; // update ICE candidates
    if(e.candidate){ callerCandidates.value += e.candidate.candidate + '\n'; }
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
  statsUpdater = setInterval(updateStats, 1000, 'caller'); // update every second

  // 1.1. Start DataChannel
  dc.local = pc.createDataChannel('Caller-text-channel', dc_config);
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
  dc.local.addEventListener('message', (e) => { // Pion does reply to the local channel!
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

  // 2. Add Tracks
  if (localStream) {
    //for(let track of localStream.getTracks()){ pc.addTransceiver(track, {direction: "sendrecv", streams: [localStream]})};
    for(let track of localStream.getTracks()){ if(track.kind==track.kind){pc.addTrack(track, localStream)}}; //=> pc.addTransceiver() because no transceiver yet [https://blog.mozilla.org/webrtc/rtcrtptransceiver-explored/]
    console.log('Added local stream to pc', pc.getSenders()); //pc.getTransceivers()
  }

  // >> on negotiationneeded { setLocalDescription()} >> ICE gathering candidates
  // >> call() { setRemoteDescription()} [>> conntected [>> on track] ]
}


async function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');

  // 4. Set RemoteDescription
  console.log('pc.setRemoteDescription() start');
  try {
    await pc.setRemoteDescription({type: 'answer', sdp: answer.value});
    console.log('pc.setRemoteDescription() completed: ', pc.remoteDescription);
    console.log('Added remote stream to pc', pc.getReceivers()); //pc.getTransceivers()
  } catch (e) {
    handleError('pc.setRemoteDescription():', e);
    return;
  }
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
  offerStatus.value = 'Waiting for Start ...';
  offerStatus.disabled = true;
  answer.value = '';
  answerStatus.value = 'Waiting for Start ...';
  answerStatus.disabled = true;
  callerCandidates.value = '';
  receiverCandidates.value = '';
}


//////////////////////// Helper functions \\\\\\\\\\\\\\\\\\\\\\\\
