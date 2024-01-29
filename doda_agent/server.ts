import { Application, Router, send } from "https://deno.land/x/oak/mod.ts";
import OpenAI from "npm:openai";
import "https://deno.land/x/dotenv/load.ts";
import { DB } from "https://deno.land/x/sqlite/mod.ts";

const app = new Application();
const router = new Router();
const connectedClients: Map<string, any> = new Map(); // specify the types of the keys and values

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const ASSISTANT_ID = Deno.env.get('ASSISTANT_ID');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function executeCommand(commandName: string, commandArgs: string[]): Promise<string> {
  console.log("executeCommand called with", commandName, commandArgs);

  const cmd = new Deno.Command(commandName, {
    args: commandArgs,
    stdout: "piped",
    stderr: "piped",
  });

  try {
    const output = await cmd.output();
    const decoder = new TextDecoder();
    const outStr = decoder.decode(output.stdout);
    const errStr = decoder.decode(output.stderr);

    console.log("Command output:", outStr);
    console.log("Command error output:", errStr);

    if (errStr) {
      // If there's an error output, return it for debugging.
      return `stderr in command execution: ${errStr}`;
    } else if (!outStr || outStr.trim() === "") {
      // If there's no output but also no error, return a generic success message.
      return "Command executed successfully, but no output was returned.";
    } else {
      // If there's valid output, return it.
      return outStr;
    }
  } catch (error) {
    console.error("caught error executing Deno command:", error);
    const errorOutput = error.stderr ? new TextDecoder().decode(error.stderr) : error.toString();
    return JSON.stringify({ error: errorOutput });
  }
}

const SCRIPTS_DIR = `${Deno.cwd()}/../doda_scripts`; // Directory where scripts are stored

async function runDodaScript(scriptName: string): Promise<string> {
  const fullPath = `${SCRIPTS_DIR}/${scriptName}`;
  console.log("Running DODA script:", fullPath);

  return executeCommand('bash', [fullPath]);
}

async function createFile(fileName: string, content: string): Promise<string> {
  try {
    // Write the content to a new file. Deno.writeTextFile creates a new file if it doesn't exist
    await Deno.writeTextFile(fileName, content);
    return `File ${fileName} created successfully.`;
  } catch (error) {
    console.error("Error creating file:", error);
    return JSON.stringify({ error: error.message });
  }
}

async function getEnvironmentDetails(): Promise<string> {
  try {
    const envVars = Deno.env.toObject();
    const currentDir = Deno.cwd();
    const osType = Deno.build.os;

    return JSON.stringify({
      currentDir,
      osType,
      envVars,
    });
  } catch (error) {
    console.error("Error getting environment details:", error);
    return JSON.stringify({ error: error.message });
  }
}

async function loadAssistantConfig(): Promise<AssistantConfig> {
  const configFile = await Deno.readTextFile("assistantConfig.json");
  return JSON.parse(configFile);
}

const defaultAssistantConfig = await loadAssistantConfig();

interface AssistantConfig {
  assistant_id?: string;
  name: string;
  instructions: string;
  tools: string[];
  model: string;
}

interface DBConfig {
  hostname: string;
  username: string;
  password: string;
  db: string;
  port: number;
}

async function executeSQL(sqlCommand: string): Promise<string> {
  try {
    const dbPath = Deno.env.get('DB_PATH');

    if (dbPath) {
      const db = new DB(dbPath);
      const result = [];
      for (const row of db.query(sqlCommand)) {
        result.push(row);
      }
      db.close();
      return JSON.stringify(result);
    } else {
      throw new Error('No DB_PATH provided, and server-based DB not configured in this example');
    }
  } catch (error) {
    console.error("Error executing SQL command:", error);
    return JSON.stringify({ error: error.message });
  }
}

async function ensureAssistant(config: AssistantConfig = defaultAssistantConfig): Promise<string> {
  if (!config.assistant_id) {
    const newAssistant = await openai.beta.assistants.create({
      name: config.name,
      instructions: config.instructions,
      tools: config.tools,
      model: config.model,
    });
    config.assistant_id = newAssistant.id;
    console.log("Created new assistant with ID:", config.assistant_id);
  } else {
    try {
      await openai.beta.assistants.retrieve(config.assistant_id);
    } catch (error) {
      console.error("Error retrieving assistant, creating a new one:", error);
      config.assistant_id = null;
      return await ensureAssistant(config); // Recursive call to retry creation
    }
  }
  return config.assistant_id;
}

async function getOrCreateThread(clientThreadId?: string): Promise<string> {
  if (clientThreadId) {
    try {
      const thread = await openai.beta.threads.retrieve(clientThreadId);
      console.log("Using existing thread with ID:", thread.id);
      return thread.id;
    } catch (error) {
      console.error("Error retrieving thread, creating a new one!");
    }
  }
  const newThread = await openai.beta.threads.create();
  console.log("Created new thread with ID:", newThread.id);
  return newThread.id;
}

// respond to user messages
interface ToolOutput {
  tool_call_id: string;
  output: string;
}

async function handleToolCalls(runStatus, threadId, runId) {
  let toolOutputs: ToolOutput[] = [];

  for (const toolCall of runStatus.required_action.submit_tool_outputs.tool_calls) {
    console.log('Handling tool call:', toolCall);
    if (toolCall.function.name === 'createFile') {
      const args = JSON.parse(toolCall.function.arguments);
      console.log('Calling createFile with args:', args);
      const output = await createFile(args.fileName, args.content);
      console.log('Output from createFile:', output);
      toolOutputs.push({ tool_call_id: toolCall.id, output });
    } else if (toolCall.function.name === 'executeCommand') {
      const args = JSON.parse(toolCall.function.arguments);
      console.log('Calling executeCommand with args:', args);
      const output = await executeCommand(args.commandName, args.commandArgs);
      console.log('Output from executeCommand:', output);
      toolOutputs.push({ tool_call_id: toolCall.id, output });
    } else if (toolCall.function.name === 'getEnvironmentDetails') {
      const args = JSON.parse(toolCall.function.arguments);
      console.log('Calling getEnvironmentDetails with args:', args);
      const output = await getEnvironmentDetails();
      console.log('Output from getEnvironmentDetails:', output);
      toolOutputs.push({ tool_call_id: toolCall.id, output });
    } else if (toolCall.function.name === 'runDodaScript') {
      const args = JSON.parse(toolCall.function.arguments);
      console.log('Calling runDodaScript with args:', args);
      const output = await runDodaScript(args.scriptName);
      console.log('Output from runDodaScript:', output);
      toolOutputs.push({ tool_call_id: toolCall.id, output });
    } else if (toolCall.function.name === 'executeSQL') {
      const args = JSON.parse(toolCall.function.arguments);
      console.log('Calling executeSQL with args:', args);
      const output = await executeSQL(args.sqlCommand);
      console.log('Output from executeSQL:', output);
      toolOutputs.push({ tool_call_id: toolCall.id, output });
    }
  }

  if (toolOutputs.length > 0) {
    console.log('Tool outputs prepared:', toolOutputs);
    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
    console.log('Tool outputs submitted:', toolOutputs);
  }
}

async function getAnswer(input, username, agent, threadIdFromClient) {
  console.log('getAnswer called', { input, username, agent, threadIdFromClient });

  const assistantId = await ensureAssistant();

  const threadId = await getOrCreateThread(threadIdFromClient);
  
  const userMessage = { role: "user", content: input };

  await openai.beta.threads.messages.create(threadId, userMessage);

  const run = await openai.beta.threads.runs.create(threadId, { assistant_id: assistantId });

  let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);

  while (runStatus.status !== "completed") {
    console.log('Waiting for run to complete...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    console.log('Polled run status:', runStatus.status);

    if (runStatus.status === "requires_action" && runStatus.required_action.type === "submit_tool_outputs") {
      console.log('Action required:', runStatus.required_action);
      await handleToolCalls(runStatus, threadId, run.id);
    }
  }
  
  console.log('Run completed. Retrieving messages...');
  const messages = await openai.beta.threads.messages.list(threadId);
  console.log('Messages retrieved:', messages.data.length, 'messages found.');

  const assistantMessages = messages.data.filter(message => message.run_id === run.id && message.role === "assistant");

  if (assistantMessages.length === 0) {
    return "I didn't get a response. Please try again later.";
  }

  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];

  return lastAssistantMessage.content[0].text.value;
}

// send a message to all connected clients
function broadcast(message, username = undefined) {
  if (!username) {
    for (const userSockets of connectedClients.values()) {
      for (const client of userSockets) {
        client.send(message);
      }
    }
    return;
  }

  const userSockets = connectedClients.get(username);
  if (userSockets) {
    for (const client of userSockets) {
      client.send(message);
    }
  }
}

// send updated users list to all connected clients
function broadcast_usernames() {
  const usernames = [...connectedClients.keys()];
  broadcast(
    JSON.stringify({
      event: "update-users",
      usernames: usernames,
    })
  );
}

router.get("/start_web_socket", async (ctx) => {
  const socket = await ctx.upgrade();
  const username = ctx.request.url.searchParams.get("username");
  socket.username = username;

  let threadIdFromClient = ctx.request.url.searchParams.get("threadId")

  const agent = ctx.request.url.searchParams.get("agent");
  socket.agent = agent; 
  
  if (!connectedClients.has(username)) {
    connectedClients.set(username, []);
  }
  const userSockets = connectedClients.get(username);
  userSockets.push(socket);

  console.log(`New client connected: ${username}. Total connected clients: ${connectedClients.size}`);

  // broadcast the active users list when a new user logs in
  socket.onopen = async () => {
    broadcast_usernames();
  
    // Send the assistant and thread IDs to the client
    const assistantId = await ensureAssistant();
    const threadId = await getOrCreateThread(threadIdFromClient); 
  
    socket.send(JSON.stringify({
      event: "init", // Change this to "init" to match client expectation
      assistantId: assistantId,
      threadId: threadId
    }));
  };

  // when a client disconnects, remove them from the connected clients list
  // and broadcast the active users list
  socket.onclose = () => {
    const userSockets = connectedClients.get(socket.username);
    const socketIndex = userSockets.indexOf(socket);
    if (socketIndex !== -1) {
      userSockets.splice(socketIndex, 1);
    }
    if (userSockets.length === 0) {
      connectedClients.delete(socket.username);
    }
    console.log(`Client disconnected: ${username}. Total connected clients: ${connectedClients.size}`);
    broadcast_usernames();
  };

  // broadcast new message if someone sent one
  socket.onmessage = (m) => {
    const data = JSON.parse(m.data);
    switch (data.event) {
      case "send-message":
        threadIdFromClient = data.threadId
        broadcast(
          JSON.stringify({
            event: "send-message",
            username: socket.username,
            message: data.message,
            threadId: threadIdFromClient
          }),
          socket.username
        );
        getAnswer(data.message, socket.username, socket.agent, threadIdFromClient).then(answer => {
          broadcast(
            JSON.stringify({
              event: "send-message",
              username: `Machine`,
              message: answer
            }),
            socket.username
          )
        })
        break;
    }
  };
});

router
  .get("/", (context) => {
    context.response.redirect("/public/index.html");
  })
  .get("/public/chat-app.js", async (context) => {
    await send(context, context.request.url.pathname, {
      root: `${Deno.cwd()}/`,
      index: "public/chat-app.js",
    });
  });

app.use(router.routes());
app.use(router.allowedMethods());

app.use(async (context) => {
  await send(context, context.request.url.pathname, {
    root: `${Deno.cwd()}/`,
    index: "public/index.html",
  });
});

const PORT = 1337;
console.log(`Server running on http://localhost:${PORT}`);
await app.listen({ port: PORT });