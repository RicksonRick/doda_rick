
const urlParams = new URLSearchParams(window.location.search);
const myUsername = 'Human'
const agent = urlParams.get('agent');

const auiScriptTag = document.currentScript;
const auiUrl = new URL(auiScriptTag.src);
const wsOrigin = auiUrl.origin.replace('http:', 'ws:').replace('https:', 'wss:');

function setCookie(name, value) {
  document.cookie = name + "=" + encodeURIComponent(value);
}

function getCookie(name) {
  // Split cookie string and get all individual name=value pairs in an array
  var cookieArr = document.cookie.split(";");
  
  // Loop through the array elements
  for(var i = 0; i < cookieArr.length; i++) {
    var cookiePair = cookieArr[i].split("=");
    
    /* Removing whitespace at the beginning of the cookie name
    and compare it with the given string */
    if(name == cookiePair[0].trim()) {
      // Decode the cookie value and return
      return decodeURIComponent(cookiePair[1]);
    }
  }
  // Return null if not found
  return null;
}

const socket = new WebSocket(
  `${wsOrigin}/start_web_socket?username=${myUsername}&agent=${agent}&threadId=${getCookie("threadId")}`
);

socket.onmessage = (m) => {
  const data = JSON.parse(m.data);

  switch (data.event) {
    case "init":
      // Store the assistantId and threadId in global variables or wherever you need them
      window.assistantId = data.assistantId;
      window.threadId = data.threadId;

      console.log(`Assistant ID: ${data.assistantId}\nThread ID: ${data.threadId}`);

      existingThreadId = getCookie("threadId");
      if(existingThreadId == null) {
        setCookie("threadId", window.threadId);
      }
      break;
    case "send-message":
      // Hide loading spinner when Assistant responds
      if(data.username == 'Machine') {
        document.getElementById("loading-spinner").style.display = "none";
      }

      // display new chat message
      addMessage(data.username, data.message, data.threadId);
      break;
  }
};

function addMessage(username, message) {
  const new_date = new Date();
  const sent_timestamp = new_date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  });

  const conversation = document.getElementById("conversation");
  const messageElement = document.createElement('div');
  conversation.appendChild(messageElement);

  if (username === 'Machine') {
    messageElement.innerHTML = `
    <div class="flex items-center justify-start w-full animate-fade-in">
      <div class="w-full p-5 bg-gray-100">
        <p class="font-bold">${username}</p>
        <p id="assistant-message-placeholder"></p>
        <span class="text-xxs md:text-xs text-gray-300 block text-right">${sent_timestamp}</span>
      </div>
    </div>
    `;

    let placeholderElement = messageElement.querySelector('#assistant-message-placeholder');
    if (message.includes('```')) {
      // If Markdown is present, render the message directly
      placeholderElement.innerHTML = marked.parse(message);
      hljs.highlightAll();
    } else {
      typeMessage(placeholderElement, message, 0);
    }

  } else {
    messageElement.innerHTML = `
    <div class="flex items-center justify-end w-full animate-fade-in">
      <div class="w-full p-5">
        <p class="font-bold">${username}</p>
        <p>${message}</p>
        <span class="text-xxs md:text-xs text-gray-300 block text-right">${sent_timestamp}</span>
      </div>
    </div>
    `;
  }

}

function typeMessage(placeholderElement, message, index) {
  if (index < message.length) {
    placeholderElement.textContent += message[index];
    setTimeout(() => typeMessage(placeholderElement, message, index + 1), 30);
  } else {
    // Replace placeholder with actual message
    placeholderElement.textContent = message;
    placeholderElement.removeAttribute('id');
  }
}

// on page load
window.onload = () => {
  // Function to send message
  function sendMessage() {
    const inputElement = document.getElementById("chat-message");
    const message = inputElement.value.trim();

    if (message !== "") {
      inputElement.value = "";

      // Show loading spinner
      document.getElementById("loading-spinner").style.display = "block";

      socket.send(
        JSON.stringify({
          event: "send-message",
          message: message,
          threadId: getCookie("threadId")
        })
      );
    }
  }

  // Event listener for Enter key press
  document.getElementById("chat-message").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();  // Prevents the default action for Enter key
      sendMessage();
    }
  });
};

function toggleFullScreen() {
  let chatApp = document.getElementById('chat-app');
  if (!document.fullscreenElement) {
    chatApp.requestFullscreen().catch(err => {
      alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
    });
  } else {
    document.exitFullscreen();
  }
}

