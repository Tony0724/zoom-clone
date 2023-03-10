// Frequently used HTML Element
const welcomeView = document.getElementById('welcome');
const welcomeForm = welcomeView.querySelector('form');
const welcomeAlert = welcomeView.querySelector('#alert');
const welcomeAlertMsg = welcomeAlert.querySelector('span');
const callView = document.getElementById('call');
const callContent = callView.querySelector('#call-content');
const myVideo = callContent.querySelector('#myVideo');
const peerVideo = callContent.querySelector('#peerVideo');
const chatBox = callContent.querySelector('#chat-wrapper');
const muteBtn = callContent.querySelector('#control button#mute');
const cameraSelect = callContent.querySelector('#camera-selection');
const cameraBtn = callContent.querySelector('#control button#camera');
const hangUpBtn = callContent.querySelector('#control button#hang-up');
const chatBtn = callContent.querySelector('#control button#chat-button');
const chatList = chatBox.querySelector('#chat-content-wrapper ul');
const chatTextArea = chatBox.querySelector('form#chat-input textarea');
const changeNickname = callContent.querySelector("#control button#nickname-change");
const screenShareVideo = callContent.querySelector("video#screenShareVideo");
const screenShareButton = callContent.querySelector("#control button#screen_share")

// Constant: List of STUN Servers
const STUN_SERVER_LIST = [
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
  'stun:stun.nextcloud.com:443',
];

// Global variables
let myStream;
let myPeerConnection;
let myDataChannel;
let roomName;
let myNickname;
let peerNickname;
let Videomuted = false;
let cameraOff = false;
let socket = createNewSocket();
// Contain information for the joining room request
const waitApprovalObj = {
  interval: null,
  counter: 0,
};

/**
 * Function to set custom --vh that matches with innerHeight of screen
 */
function setScreenSize() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

/**
 * Helper function create new socket
 *
 * @return {Socket} SocketIO socket that will connect to signaling server
 */
function createNewSocket() {
  // Will use same domain (window.location) address to establish connection
  const newSocket = io.connect(window.location.host, {
    path: `${window.location.pathname}socket.io`,
  });

  // SocketIO: "join-room" event - Another user asks to join currentRoom
  // Current user needs to approve or reject the request within 30 second
  newSocket.on('join-room', (nickname, socketId) => {
    // Save peer's nickname
    peerNickname = nickname;

    // Display modal (count 30 second)
    const modalWrapper = callView.querySelector('#confirm-join-overlay');
    const confirmJoinModal = modalWrapper.querySelector('#confirm-join');
    modalWrapper.style.display = 'flex';
    confirmJoinModal.style.display = 'flex';
    confirmJoinModal.querySelector(
      '#request-nickname'
    ).innerHTML = `<b>${nickname}</b><br>wants to join the call`;
    waitApprovalObj.counter = 30;
    waitApprovalObj.interval = setInterval(() => {
      // Display Message
      const modalMsg = confirmJoinModal.querySelector('#confirm-message');
      modalMsg.innerText = `Will you approve the user to join the chat? (${waitApprovalObj.counter})`;

      if (waitApprovalObj.counter !== 0) {
        // Reduce counter by 1
        --waitApprovalObj.counter;
      } else {
        // Timeout (30 second passed)
        clearInterval(waitApprovalObj.interval);

        // Hide Modal
        modalWrapper.style.display = 'none';
        confirmJoinModal.style.display = 'none';
      }
    }, 1000);

    // Press Approve
    const approveBtn = confirmJoinModal.querySelector('#approve');
    approveBtn.onclick = () => {
      // Emit message indicating the peer has been approved
      newSocket.emit('approve-peer', roomName, myNickname, socketId);
      // Hide Modal
      modalWrapper.style.display = 'none';
      confirmJoinModal.style.display = 'none';
      clearInterval(waitApprovalObj.interval);

      // Display peerNickname
      callContent.querySelector('#peerNickname').innerText = peerNickname;
    };

    // Press Decline
    const declineBtn = confirmJoinModal.querySelector('#decline');
    declineBtn.onclick = () => {
      // Emit message indicating the peer has been declined
      newSocket.emit('decline-peer', socketId);
      // Hide Modal
      modalWrapper.style.display = 'none';
      confirmJoinModal.style.display = 'none';
    };
  });

  // SocketIO: 'approved' event - When remote peer approved to join the room
  //   Send the room owner a 'hello' message
  newSocket.on('approved', async (ownerNickname) => {
    // Clear Interval showing wait message
    clearInterval(waitApprovalObj.interval);

    // Init call
    await camStart();
    makeConnection(); // create webRTC Connection
    // Display
    displayCall();
    // Nickname
    peerNickname = ownerNickname;
    callContent.querySelector('#peerNickname').innerText = ownerNickname;

    // Notify to room owner
    newSocket.emit('hello', roomName);
  });

  // SocketIO: 'declined' event - When remote peer decline to join the room
  //   Display message and enable form to enter another room name and nickname
  newSocket.on('declined', () => {
    // Clear Interval showing wait message
    clearInterval(waitApprovalObj.interval);
    // Display message
    welcomeAlertMsg.innerText = 'Declined to join the room!! Try Again!!';

    // Enable form
    const formElements = welcomeForm.elements;
    for (let index = 0; index < formElements.length; index++) {
      formElements[index].disabled = false;
    }
  });

  // SocketIO: 'welcome' event - When remote peer successfully joined the room
  //   Send the webRTC offer to the remote peer
  newSocket.on('welcome', async () => {
    myDataChannel = myPeerConnection.createDataChannel('chat');

    // EventListener: When datachannel receives new message
    myDataChannel.addEventListener('message', (messageEvent) => {
      // Display peer's message
      addChatMessage('peer-chat', messageEvent.data);
    });

    // After join, send WebRTC Offer
    const webRTCOffer = await myPeerConnection.createOffer();
    await myPeerConnection.setLocalDescription(webRTCOffer);
    newSocket.emit('offer', roomName, webRTCOffer);
  });

  // SocketIO: 'offer' event - When the room owner send the webRTCOffer
  //   Remote peer should "answer" to the offer
  newSocket.on('offer', async (webRTCOffer) => {
    // Set dataChannel for chatting
    myPeerConnection.addEventListener('datachannel', (dataChannelEvent) => {
      myDataChannel = dataChannelEvent.channel;

      // EventListener: When datachannel receives new message
      myDataChannel.addEventListener('message', (messageEvent) => {
        // Display peer's message
        addChatMessage('peer-chat', messageEvent.data);
      });
    });

    // Setup remoteDescription to establish connection
    await myPeerConnection.setRemoteDescription(webRTCOffer);
    // Create webRTCAnswer
    const webRTCAnswer = await myPeerConnection.createAnswer();
    myPeerConnection.setLocalDescription(webRTCAnswer);
    newSocket.emit('answer', roomName, webRTCAnswer);
  });

  // SocketIO: 'answer' event - When the remote peer reply back to
  //   the previous offer.
  newSocket.on('answer', (webRTCAnswer) => {
    // Set remote description of peer connection
    myPeerConnection.setRemoteDescription(webRTCAnswer);
  });

  // SocketIO: 'ice-candidate' event
  //   - Both party should share the ice-candidate information
  newSocket.on('ice-candidate', (iceCandidate) => {
    myPeerConnection.addIceCandidate(iceCandidate);
  });

  // SocketIO: 'peer-leaving' event
  //   - Display modal popup that peer has been left
  newSocket.on('peer-leaving', () => {
    // Peer disconnected
    peerNickname = '';
    callContent.querySelector('#peerNickname').innerText = peerNickname;
    // Remote peerVideo
    peerVideo.srcObject.getTracks().forEach((track) => {
      track.stop();
    });
    peerVideo.srcObject = null;
    chatList.innerHTML = '';

    // Display Modal
    const modalWrapper = callView.querySelector('#disconnected-peer-overlay');
    const disconnectedPeer = modalWrapper.querySelector('#disconnected-peer');
    modalWrapper.style.display = 'flex';
    disconnectedPeer.style.display = 'flex';

    // Press Leave Room Button
    const leaveRoomBtn = disconnectedPeer.querySelector('button#leave-room');
    leaveRoomBtn.onclick = () => {
      // Hide Modal
      modalWrapper.style.display = 'none';
      disconnectedPeer.style.display = 'none';
      // Leave Chat Room
      hangUp();
    };

    // Press Stay Button
    const stayRoomBtn = disconnectedPeer.querySelector('button#stay-room');
    stayRoomBtn.onclick = async () => {
      // Create new RTCPeerConnection to standby for peer
      await myPeerConnection.close();
      myPeerConnection = undefined;
      makeConnection();

      // Hide Modal
      modalWrapper.style.display = 'none';
      disconnectedPeer.style.display = 'none';
    };
  });

  return newSocket;
}

/**
 * Display Main/Welcome view
 */
function displayMain() {
  // Reset Main view
  // Clear Interval
  clearInterval(waitApprovalObj.interval);
  // Enable form
  const formElements = welcomeForm.elements;
  for (let index = 0; index < formElements.length; index++) {
    formElements[index].disabled = false;
  }
  // Hide Message
  welcomeAlertMsg.innerText = '';
  welcomeAlert.style.display = 'none';

  welcomeView.style.display = 'flex';
  callView.style.display = 'none';
  chatBox.style.display = 'none';
}

/**
 * Display Call view
 */
function displayCall() {
  // Nickname
  const nickNameMuted = callContent.querySelector('#myNickname');
  nickNameMuted.innerText = myNickname;

  welcomeView.style.display = 'none';
  callView.style.display = 'flex';
}

/**
 * Start Camera
 *  - Generate new stream
 */
async function camStart() {
  // When current stream exists, stop the tracks
  if (myStream) {
    myStream.getTracks().forEach((track) => {
      // Clearly indicates that the stream no longer uses the source
      track.stop();
    });
  }

  // Create new video stream
  const videoSource = cameraSelect.value;
  const constraints = {
    audio: true,
    video: { deviceId: videoSource ? { exact: videoSource } : undefined },
  };
  try {
    myStream = await navigator.mediaDevices.getUserMedia(constraints);
    // Display video from the selected camera
    myVideo.srcObject = myStream;

    // Build/Update list of cameras
    cameraSelect.innerHTML = '';
    const devicesInfo = await navigator.mediaDevices.enumerateDevices();
    const cameraDevices = devicesInfo.filter(
      (device) => device.kind === 'videoinput'
    );
    const currentCamera = myStream.getVideoTracks()[0].label;
    cameraDevices.forEach((camera) => {
      const option = document.createElement('option');
      option.value = camera.deviceId;
      option.innerText = camera.label;
      if (currentCamera === camera.label) {
        option.selected = true;
      }
      cameraSelect.appendChild(option);
    });
  } catch (e) {
    console.error(e);
  }
}

/**
 * Creating new RTCPeerConnection
 */
function makeConnection() {
  myPeerConnection = new RTCPeerConnection({
    iceServers: [{ urls: STUN_SERVER_LIST }],
  });

  // EventListner (myPeerConnection):
  //   iceCandidateEvent --> Receive iceCandidateEvent
  // The iceCandiate information needs to be transferred to the remote peer
  myPeerConnection.addEventListener('icecandidate', (iceCandidateEvent) => {
    socket.emit('ice-candidate', roomName, iceCandidateEvent.candidate);
  });

  // // EventListener (myPeerConnection):
  // //   addStream --> RTCPeerConnection get new MediaStream object
  // // Display the new media stream as the peer's video
  // // This event has been depreciated
  // myPeerConnection.addEventListener('addstream', (addstreamEvent) => {
  //   peerVideo.srcObject = addstreamEvent.stream;
  // });

  // EventListener (myPeerConnection):
  //   trackEvent --> RTCPeerConnection get new Track
  // Display new video track as the peer's video
  myPeerConnection.addEventListener('track', (trackEvent) => {
    peerVideo.srcObject = trackEvent.streams[0];
  });

  // Add current media stream to the RTCPeerConnection
  //   to send the stream to peer
  myStream.getTracks().forEach((track) => {
    myPeerConnection.addTrack(track, myStream);
  });
}

/**
 * Helper method to add message to the chatList
 *
 * @param {string} chatType Based on the sender of the message
 *   (either peer or me), the chatType is defined.
 *   Use 'my-chat' for the message that current user send;
 *   Otherwise, use 'peer-chat'
 * @param {string} msg The content of message
 */
function addChatMessage(chatType, msg) {
  // Create HTML Elements
  const listElem = document.createElement('li');
  const divSpacer = document.createElement('div');
  const divSpanWrapper = document.createElement('div');
  const span = document.createElement('span');

  // Define Proper class Type
  listElem.classList.add(chatType);
  divSpacer.classList.add('chat-spacer');
  divSpanWrapper.classList.add('chat-span-wrapper');

  // Add Message
  span.innerText = msg;
  divSpanWrapper.appendChild(span);
  listElem.appendChild(divSpacer);
  listElem.appendChild(divSpanWrapper);
  chatList.appendChild(listElem);

  // Display chatBox
  chatBox.style.display = 'flex';
}

/**
 * Helper function to leave a call
 */
function hangUp() {
  // Disconnect peer connection (WebRTC)
  myPeerConnection.close();
  myPeerConnection = null;
  myDataChannel = null;
  myNickname = '';
  peerNickname = '';
  chatList.innerHTML = '';
  callContent.querySelector('#myNickname').innerText = myNickname;
  callContent.querySelector('#peerNickname').innerText = peerNickname;

  // Stop Video
  myStream.getTracks().forEach((track) => {
    // Clearly indicates that the stream no longer uses the source
    track.stop();
  });
  // Stop PeerVideo
  if (peerVideo?.srcObject) {
    peerVideo.srcObject.getTracks().forEach((track) => {
      track.stop();
    });
    peerVideo.srcObject = null;
  }

  // Leave room and notify to the peer
  socket.emit('leave-room', roomName, () => {
    roomName = '';

    // Generate new socketIO socket (disconnect from previous)
    socket.disconnect();
    socket = createNewSocket();
    displayMain();
  });
}

// EventListener (WelcomeForm): Process user's request to join the room
welcomeForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();

  // Hide alerts
  welcomeAlert.style.display = 'none';

  // User Inputs
  myNickname = welcomeForm.querySelector('#nickname').value;
  roomName = welcomeForm.querySelector('#room-name').value;

  // Signaling Server
  socket.emit('join-room', myNickname, roomName, async (status) => {
    switch (status) {
      case 'created-room':
        // Init call
        await camStart();
        makeConnection(); // create webRTC Connection
        // Display
        displayCall();
        break;
      case 'wait-approval':
        // disable form
        const formElements = welcomeForm.elements;
        for (let index = 0; index < formElements.length; index++) {
          formElements[index].disabled = true;
        }

        // display message (Count 30 second)
        welcomeAlert.style.display = 'block';
        waitApprovalObj.counter = 30;
        waitApprovalObj.interval = setInterval(() => {
          // Display Message
          welcomeAlertMsg.innerText = `Waiting for Approval (${waitApprovalObj.counter})`;

          if (waitApprovalObj.counter !== 0) {
            // Reduce counter by 1
            --waitApprovalObj.counter;
          } else {
            // Timeout (30 second passed)
            clearInterval(waitApprovalObj.interval);

            // Generate new socketIO socket (disconnect from previous)
            socket.disconnect();
            socket = createNewSocket();
            // Enable form
            for (let index = 0; index < formElements.length; index++) {
              formElements[index].disabled = false;
            }

            // Display Retry message
            welcomeAlertMsg.innerText = `Not Approved Yet! Try Again!`;
          }
        }, 1000);
        break;
      case 'exceed-max-capacity':
        // display message
        welcomeAlert.style.display = 'block';
        welcomeAlertMsg.innerText = 'Exceed Max Capacity of Room!! Try Again!';
        break;
    }
  });
});

// EventListener (cameraSelect):
//   When camera changes, changing both video's source
cameraSelect.addEventListener('change', async () => {
  // Restart/Create new camera video
  await camStart();

  // Change video tracks for the peer connection
  if (myPeerConnection) {
    const videoTrack = myStream.getVideoTracks()[0];
    const videoSender = myPeerConnection
      .getSenders()
      .find((sender) => sender.track.kind === 'video');
    videoSender.replaceTrack(videoTrack);
  }
});

// EventListener (muteBtn): mute/unmute the recording audio
muteBtn.addEventListener('click', () => {
  myStream.getAudioTracks().forEach((track) => {
    track.enabled = !track.enabled;
  });
  if (!Videomuted) {
    Videomuted = true;
    muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
  } else {
    Videomuted = false;
    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
  }
});

// EventListener (cameraBtn): Turn on/off camera
cameraBtn.addEventListener('click', () => {
  myStream.getVideoTracks().forEach((track) => {
    track.enabled = !track.enabled;
  });
  if (cameraOff) {
    cameraOff = false;
    cameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
  } else {
    cameraOff = true;
    cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
  }
});

// EventListener (hangUpBtn): Leave Call
//   Notify the remotePeer('leave-room') and leave call
hangUpBtn.addEventListener('click', () => {
  hangUp();
});

// EventListener (chatBtn): Display/Hide Chat Box
chatBtn.addEventListener('click', () => {
  if (chatBox.style.display === 'none') {
    chatBox.style.display = 'flex';
  } else {
    chatBox.style.display = 'none';
  }
});

// EventListener (chatTextArea): When enter pressed, submit the form
// Form behavior is defined when dataChannel established
chatTextArea.addEventListener('keydown', (keyboardEvent) => {
  if (keyboardEvent.key === 'Enter') {
    keyboardEvent.preventDefault();
    const msg = chatTextArea.value;

    myDataChannel?.send(msg); // Send Chat
    // Display the message
    addChatMessage('my-chat', msg);
    chatTextArea.value = '';
  }
});

// EventListener: change nickname
changeNickname.addEventListener("click", () => {
  let prom = prompt("Change nickname as you want!", myNickname)
  if(prom == null) {
    alert("If you think of a nickname to change, please type it again.")
  } else if(prom.length < 2) {
      alert("Please, write a nickname enter at least 2 characters!")
  } else {
      socket.emit("change_nickname", roomName, prom)
      const nickname = callContent.querySelector('#myNickname');
      nickname.innerText = prom;
  }
})

socket.on("change_nickname", (nickname) => {
  const nicknameMusted = callContent.querySelector("#peerNickname");
  nicknameMusted.innerText = nickname;
  setTimeout(() => {
    alert(`Your contact has changed his nickname to ${nickname}.`)
  }, 2000);
})

// EventListener: Screen Share Event

let ScreenStream = null;
async function handleScreenShareClick() {
  try {
    socket.emit("screen_start")
    ScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {cursor: "always"},
      audio: true,
    })
    screenShareVideo.srcObject = ScreenStream;
  } 
  catch(e) {
    console.error("Error:", e)
  }
}

screenShareButton.addEventListener("click", handleScreenShareClick)

// EventListener: Dynamically change screen size
window.addEventListener('resize', () => {
  setScreenSize();
});

// Website need to display the main screen at the beginning
setScreenSize();
displayMain();