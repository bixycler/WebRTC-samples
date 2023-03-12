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

const recvAlso = document.getElementById('recvalso');
const sendOnly = document.getElementById('sendonly');
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
recvAlso.addEventListener('change', ()=>{
  updateOnly(recvAlso,sendOnly,remoteVideo,recvVidres);
});
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
  pc_config['iceServers'].push( 
    { 'urls': dummyServerURL, // dummy server for crypto params
          'username': "crypto:"+cipherSuite.value,
          'credential': "inline:"+masterKey.value // To be parsed by SrtpTransport::ParseKeyParams()
    },
    { 'urls': dummyServerURL, // dummy server for audio params
          'username': 'audio:0',
          'credential': audioTrackConfig.value
    },
    { 'urls': dummyServerURL, // dummy server for video params
          'username': 'video:0',
          'credential': videoTrackConfig.value
    }
  );
  
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
      //let dsc = await pc.createOffer();
      //console.log('pc.createOffer() completed: '+ dsc.sdp);
      await pc.setLocalDescription();//(dsc);
      console.log('pc.setLocalDescription() completed: ', pc.localDescription);
      offer.value = pc.localDescription.sdp; // media metadata
      /*for(let sender of pc.getSenders()){ 
        let params = sender.getParameters();
        if(sender.track.kind == 'video'){
          params.encodings[0].maxBitrate = 100000; //100kbps: throttle bandwidth to very low value to see the effect clearly
          params.encodings[0].maxFramerate = 10; //10fps is slow enough to see the effect
          sender.setParameters(params);
        }
        console.log(sender.track,"encoding parameters: ",params);
      }*/
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
  recvAlso.disabled = true;
  if (localStream) {
    for(let track of localStream.getTracks()){ 
      //let sender = pc.addTrack(track, localStream);  //=> pc.addTransceiver() because no transceiver yet [https://blog.mozilla.org/webrtc/rtcrtptransceiver-explored/]
      let senddir = recvAlso.checked? "sendrecv": "sendonly";
      let sendencs = [ //simulcast
        //{rid: "High",   maxBitrate: 1600*1024, scaleResolutionDownBy: 1},
        //{rid: "Medium", maxBitrate:  400*1024, scaleResolutionDownBy: 2},
        {rid: "Low",    maxBitrate:  100*1024, scaleResolutionDownBy: 4}
      ];
      if(track.kind=='audio'){ sendencs = []; }
      let trsv = pc.addTransceiver(track, {direction: senddir, streams: [localStream], sendEncodings: sendencs});
      console.log('Added "'+senddir+'" transceiver for '+track.kind+' track: ',trsv);
    };
    console.log('Added local stream to pc: ', pc.getSenders()); //pc.getTransceivers()
    /*if(!recvAlso.checked){
      let trsvs = pc.getTransceivers()
      for(let trsv of trsvs){ 
        trsv.direction = "sendonly"; 
      }
      console.log('Transceivers direction set to "sendonly"',trsvs);
    }*/
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
    if(recvAlso.checked){
      let trsvs = pc.getTransceivers();
      let sendonly = (trsvs.filter(trsv=>(trsv.currentDirection!="sendonly")).length==0);
      recvAlso.checked = !sendonly; 
      updateOnly(recvAlso,sendOnly,remoteVideo,recvVidres);
      if(sendonly){ console.log('Transceivers current direction = "sendonly"',trsvs);}
    }
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
