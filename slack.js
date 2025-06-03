// -------------------------------------------------------------------------
// スクリプトプロパティから設定値を読み込む
// -------------------------------------------------------------------------
const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const GROQ_API_KEY = SCRIPT_PROPS.getProperty("GROQ_API_KEY");
const SLACK_BOT_TOKEN = SCRIPT_PROPS.getProperty("SLACK_BOT_TOKEN");

// -------------------------------------------------------------------------
// 定数
// -------------------------------------------------------------------------
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile"; // Groqのドキュメントで利用可能な最新のモデル名を確認してください。

// -------------------------------------------------------------------------
// SlackからのWebhookリクエストを処理するメイン関数
// -------------------------------------------------------------------------
function doPost(e) {
  // APIキーやトークンが設定されているか確認
  if (!GROQ_API_KEY || !SLACK_BOT_TOKEN) {
    console.error("APIキーまたはSlackボットトークンがスクリプトプロパティに設定されていません。");
    // 必要に応じてSlackにエラーメッセージを返す処理を追加できます。
    return ContentService.createTextOutput(JSON.stringify({ "error": "Configuration error" })).setMimeType(ContentService.MimeType.JSON);
  }

  const eventData = JSON.parse(e.postData.contents);

  if (eventData.type === "url_verification") {
    return ContentService.createTextOutput(eventData.challenge);
  }

  if (eventData.event && eventData.event.type === "app_mention") {
    const userMessage = eventData.event.text;
    const channelId = eventData.event.channel;
    const threadTs = eventData.event.ts;
    const actualMessage = userMessage.replace(/<@.*?>\s*/, "").trim();

    if (actualMessage) {
      try {
        const aiResponse = callGroqApi(actualMessage);
        postToSlack(channelId, aiResponse, threadTs);
      } catch (error) {
        console.error("エラーが発生しました: " + error.toString());
        postToSlack(channelId, "ごめんなさい、エラーが発生しました。", threadTs); // エラーメッセージを簡略化
      }
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ "status": "success" })).setMimeType(ContentService.MimeType.JSON);
}

// -------------------------------------------------------------------------
// Groq APIにリクエストを送信する関数
// -------------------------------------------------------------------------
function callGroqApi(userInput) {
  const headers = {
    "Authorization": "Bearer " + GROQ_API_KEY,
    "Content-Type": "application/json"
  };

  const payload = {
    "messages": [
      {
        "role": "user",
        "content": userInput
      }
    ],
    "model": GROQ_MODEL,
    "temperature": 0.5,
    "max_tokens": 1024,
    "top_p": 1,
    "stream": false,
    "stop": null
  };

  const options = {
    "method": "post",
    "headers": headers,
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  console.log("Groq API Request Payload (の一部): model=" + payload.model + ", user_input_length=" + userInput.length); // 機密情報を含む可能性があるため、ペイロード全体のログ出力は注意

  const response = UrlFetchApp.fetch(GROQ_API_URL, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  console.log("Groq API Response Code: " + responseCode);
  // console.log("Groq API Response Body: " + responseBody); // レスポンスも長大な場合があるため、デバッグ時のみ有効化

  if (responseCode === 200) {
    const jsonResponse = JSON.parse(responseBody);
    if (jsonResponse.choices && jsonResponse.choices[0] && jsonResponse.choices[0].message) {
      return jsonResponse.choices[0].message.content;
    } else {
      console.error("Groq APIからの予期せぬレスポンス形式: " + responseBody.substring(0, 500)); // 長すぎるエラーログを避ける
      throw new Error("Groq APIからの応答を解析できませんでした。");
    }
  } else {
    console.error("Groq APIエラー: " + responseCode + " - " + responseBody.substring(0, 500));
    throw new Error("Groq APIリクエストに失敗しました。ステータスコード: " + responseCode);
  }
}

// -------------------------------------------------------------------------
// Slackにメッセージを投稿する関数
// -------------------------------------------------------------------------
function postToSlack(channelId, messageText, threadTs) {
  const slackUrl = "https://slack.com/api/chat.postMessage";
  const headers = {
    "Authorization": "Bearer " + SLACK_BOT_TOKEN,
    "Content-Type": "application/json; charset=utf-8"
  };

  const payload = {
    "channel": channelId,
    "text": messageText,
  };

  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const options = {
    "method": "post",
    "headers": headers,
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(slackUrl, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    console.error("Slackへの投稿エラー: " + responseCode + " - " + responseBody.substring(0, 500));
  } else {
    console.log("Slackへの投稿成功。"); // レスポンスボディは通常不要なため省略
  }
}

// -------------------------------------------------------------------------
// スクリプトプロパティ設定用のヘルパー関数 (通常は使用しません)
// -------------------------------------------------------------------------
/*
// この関数は、手動でスクリプトプロパティを設定する代わりに、
// 一度だけGASエディタから実行してプロパティを設定するために使用できます。
// 実行後はコメントアウトするか削除してください。
function initializeScriptProperties() {
  PropertiesService.getScriptProperties().setProperty("GROQ_API_KEY", "ここにあなたのGroq APIキーを貼り付け");
  PropertiesService.getScriptProperties().setProperty("SLACK_BOT_TOKEN", "ここにあなたのSlackボットトークンを貼り付け");
  console.log("スクリプトプロパティが設定されました。この関数は再度実行する必要はありません。");
}
*/

// -------------------------------------------------------------------------
// テスト用の関数
// -------------------------------------------------------------------------
function testGroqApiCall_withProperties() {
  if (!GROQ_API_KEY || !SLACK_BOT_TOKEN) {
    console.error("テスト実行前に、スクリプトプロパティにGROQ_API_KEYとSLACK_BOT_TOKENを設定してください。");
    return;
  }
  try {
    const userInput = "スクリプトプロパティのテストです。今日の天気は？";
    const aiResponse = callGroqApi(userInput);
    console.log("AIからの応答: " + aiResponse);

    // const TEST_CHANNEL_ID = "C0XXXXXXXXX"; // ご自身のテスト用チャンネルIDに置き換えてください
    // if (TEST_CHANNEL_ID && TEST_CHANNEL_ID !== "C0XXXXXXXXX") {
    //   postToSlack(TEST_CHANNEL_ID, "テストメッセージ (プロパティ利用):\n" + aiResponse);
    // } else {
    //   console.log("テスト用のSlackチャンネルIDが設定されていません。Slackへの投稿はスキップされました。");
    // }

  } catch (error) {
    console.error("テスト中にエラーが発生しました: " + error.toString());
  }
}
