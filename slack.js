// -------------------------------------------------------------------------
// スクリプトプロパティから設定値を読み込む
// -------------------------------------------------------------------------
const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const GROQ_API_KEY = SCRIPT_PROPS.getProperty("GROQ_API_KEY");
const SLACK_BOT_TOKEN = SCRIPT_PROPS.getProperty("SLACK_BOT_TOKEN");
const YAHOO_APP_ID = SCRIPT_PROPS.getProperty("YAHOO_APP_ID"); // ★追加: Yahoo!アプリID

// -------------------------------------------------------------------------
// 定数
// -------------------------------------------------------------------------
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile"; 
const YAHOO_WEATHER_API_URL = "https://map.yahooapis.jp/weather/V1/place"; // ★追加: Yahoo!天気APIのURL
const TARGET_COORDINATES = "139.92050658,36.47399159"; // ★追加: 天気取得の対象座標 (栃木県上三川町付近)

// -------------------------------------------------------------------------
// SlackからのWebhookリクエストを処理するメイン関数
// -------------------------------------------------------------------------
function doPost(e) {
  try {
    // APIキーやトークンが設定されているか確認
    if (!GROQ_API_KEY || !SLACK_BOT_TOKEN || !YAHOO_APP_ID) { // ★修正: YAHOO_APP_IDのチェックを追加
      console.error("必要なAPIキーまたはSlackボットトークンがスクリプトプロパティに設定されていません。");
      return ContentService.createTextOutput(JSON.stringify({ "error": "Configuration error" })).setMimeType(ContentService.MimeType.JSON);
    }

    const eventData = JSON.parse(e.postData.contents);

    // Slack APIのURL検証チャレンジリクエストへの対応
    if (eventData.type === "url_verification") {
      return ContentService.createTextOutput(eventData.challenge);
    }

    // SlackイベントIDによる重複実行防止 (CacheService利用)
    const uniqueEventKey = eventData.event && eventData.event.ts ? eventData.event.channel + "_" + eventData.event.ts : null;

    if (uniqueEventKey) {
      const cache = CacheService.getScriptCache();
      const processed = cache.get(uniqueEventKey);
      if (processed) {
        console.log("重複イベントをスキップ (キー: " + uniqueEventKey + ")");
        return ContentService.createTextOutput(JSON.stringify({ "status": "skipped_duplicate_event" })).setMimeType(ContentService.MimeType.JSON);
      }
      cache.put(uniqueEventKey, "processed", 600); // 600秒 = 10分
    } else if (eventData.event && eventData.event.type === "app_mention") {
        console.warn("重複チェックのためのユニークなイベントキーが取得できませんでした。 event.ts などを確認してください。");
    }


    if (eventData.event && eventData.event.type === "app_mention") {
      const userMessage = eventData.event.text;
      const channelId = eventData.event.channel;
      const threadTs = eventData.event.ts;
      const actualMessage = userMessage.replace(/<@.*?>\s*/, "").trim();

      if (actualMessage) {
        try {
          let aiResponseMessage = "";
          
          // ★追加: 天気関連のキーワードをチェック
          if (isWeatherRelated(actualMessage)) {
            console.log("天気関連のキーワードを検出しました。Yahoo!天気APIを呼び出します。");
            aiResponseMessage = getYahooWeather(); // Yahoo!天気APIを呼び出し、降水予報を取得
          } else {
            console.log("天気関連のキーワードがないため、Groq APIを呼び出します。");
            const groqResponse = callGroqApi(actualMessage); // オブジェクトで結果を受け取る
            aiResponseMessage = groqResponse.text;

            if (groqResponse.finish_reason === "length") {
              aiResponseMessage += "\n\n... (応答が長すぎるため、途中で終了しました)";
              console.warn("Groq APIの応答がmax_tokensに達しました。");
            }
          }
          
          postToSlack(channelId, aiResponseMessage, threadTs);

        } catch (error) {
          console.error("API呼び出しまたはSlack投稿でエラーが発生しました: " + error.toString() + "\nStack: " + error.stack);
          postToSlack(channelId, "ごめんなさい、処理中にエラーが発生しました。", threadTs);
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ "status": "success" })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error("doPost全体で予期せぬエラーが発生しました: " + error.toString() + "\nStack: " + error.stack);
    return ContentService.createTextOutput(JSON.stringify({ "status": "unhandled_error_in_gas" })).setMimeType(ContentService.MimeType.JSON);
  }
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
        "role": "system",
        "content": "あなたは親切で有能なAIアシスタントです。常に日本語で応答してください。最大トークン数以内で出力してください。"
      },
      {
        "role": "user",
        "content": userInput
      }
    ],
    "model": GROQ_MODEL,
    "temperature": 0.5,
    "max_tokens": 1024, // 必要に応じて調整
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

  console.log("Groq API Request Payload (の一部): model=" + payload.model + ", user_input_length=" + userInput.length);

  const response = UrlFetchApp.fetch(GROQ_API_URL, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  console.log("Groq API Response Code: " + responseCode);

  if (responseCode === 200) {
    const jsonResponse = JSON.parse(responseBody);
    if (jsonResponse.choices && jsonResponse.choices[0] && jsonResponse.choices[0].message) {
      return {
        text: jsonResponse.choices[0].message.content,
        finish_reason: jsonResponse.choices[0].finish_reason
      };
    } else {
      console.error("Groq APIからの予期せぬレスポンス形式: " + responseBody.substring(0, 500));
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
    console.log("Slackへの投稿成功。");
  }
}

// -------------------------------------------------------------------------
// ★追加: ユーザー入力が天気関連かどうかを判定する関数
// -------------------------------------------------------------------------
function isWeatherRelated(text) {
  const weatherKeywords = ["天気", "雨", "雪", "晴れ", "曇り", "降水", "気温", "気象", "予報", "傘"];
  for (let i = 0; i < weatherKeywords.length; i++) {
    if (text.includes(weatherKeywords[i])) {
      return true;
    }
  }
  return false;
}

// -------------------------------------------------------------------------
// ★追加: Yahoo!天気APIを呼び出し、降水予報を取得・整形する関数
// -------------------------------------------------------------------------
function getYahooWeather() {
  const apiUrl = `${YAHOO_WEATHER_API_URL}?appid=${YAHOO_APP_ID}&coordinates=${TARGET_COORDINATES}&output=json`;

  const options = {
    "method": "get",
    "muteHttpExceptions": true // エラー時も例外を投げずにレスポンスを取得
  };

  console.log("Yahoo!天気APIを呼び出し中...");
  let responseText = "天気情報の取得に失敗しました。"; // デフォルトのエラーメッセージ

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    console.log("Yahoo!天気API Response Code: " + responseCode);
    console.log("Yahoo!天気API Response Body: " + responseBody.substring(0, 500)); // 長すぎる場合は一部のみログ

    if (responseCode === 200) {
      const jsonResponse = JSON.parse(responseBody);

      if (jsonResponse.Feature && jsonResponse.Feature.length > 0) {
        const weatherList = jsonResponse.Feature[0].Property.WeatherList.Weather;
        let weatherMessage = "現在の降水状況と今後の予報です（栃木県上三川町付近）：\n\n";

        // 現在の降水量を表示
        const observation = weatherList.find(w => w.Type === "observation");
        if (observation) {
          weatherMessage += `現在 (${formatDate(observation.Date)}): 降水量 ${observation.Rainfall} mm/h\n`;
        }

        weatherMessage += "\n向こう2時間（10分ごと）の降水量：\n";

        // 過去のデータは不要なので、現在の時刻より後のforecastデータを抽出
        // APIは60分間の情報を提供。現在時刻から2時間後までなので、現在の観測データ以降、最大12件（10分x12=120分=2時間）のforecastデータを対象とする
        // Date形式: YYYYMMDDHHMM
        const now = new Date();
        // 現在の時刻をYahoo! APIのDate形式に変換 (YYYMMDDHHMM)
        const currentYahooTime = Utilities.formatDate(now, 'JST', 'yyyyMMddHHmm');

        let forecastCount = 0;
        for (const weatherItem of weatherList) {
          // forecastタイプで、かつ現在時刻より後のデータのみを対象
          // APIは最大60分間の予報しか提供しないため、2時間分は現在のデータと10分刻みx5個で60分 + 60分後のデータ
          // 現状のAPIでは2時間先までの細かい予報は取得できないので、最大60分間の予報を表示
          // ユーザーの要件「メッセージを受け取った時点から2時間後までの降水量を表示」に対応するため、APIの仕様内で可能な限り対応
          // 今回のAPIは1時間分の予報。2時間まで取得したい場合は、APIの仕様を確認するか、別のAPIを検討する必要がある。
          // ここでは「現時点から今後の」予報として、取得できる範囲（最大60分）を表示します。
          // もし2時間後まで正確に必要であれば、別のAPI（例えばOpenWeatherMapのOne Call APIなど）の検討が必要です。
          
          if (weatherItem.Type === "forecast") {
            const itemDate = weatherItem.Date;
            // 取得した予報時刻が現在の時刻より後であれば表示
            // APIのタイムスタンプはYYYYMMDDHHMM形式なので、単純な文字列比較で順序を判定できる
            if (itemDate > currentYahooTime) {
                weatherMessage += `${formatDate(itemDate)}: 降水量 ${weatherItem.Rainfall} mm/h\n`;
                forecastCount++;
                if (forecastCount >= 11) { // 観測データを除き、10分間隔の予報を最大11件 (約1時間50分後まで) 表示
                    break;
                }
            }
          }
        }
        
        if (forecastCount === 0 && observation && observation.Rainfall === 0.0) {
          weatherMessage += "向こう1時間程度の降水予報はありません。";
        } else if (forecastCount === 0) {
          weatherMessage += "今後の降水予報データがありませんでした。";
        }

        return weatherMessage;

      } else {
        console.warn("Yahoo!天気APIレスポンスにFeatureデータが見つかりませんでした。");
        return "天気情報を取得できませんでした。場所の指定が間違っているか、データがありません。";
      }
    } else {
      return `Yahoo!天気APIエラー: ステータスコード ${responseCode}。詳細: ${responseBody.substring(0, 200)}...`;
    }
  } catch (error) {
    console.error("Yahoo!天気APIの呼び出し中にエラーが発生しました: " + error.toString() + "\nStack: " + error.stack);
    return "天気情報の取得中に予期せぬエラーが発生しました。";
  }
}

// -------------------------------------------------------------------------
// ★追加: Yahoo!天気APIのDate形式 (YYYYMMDDHHMM) を整形するヘルパー関数
// -------------------------------------------------------------------------
function formatDate(yahooDateString) {
  if (yahooDateString.length !== 12) {
    return yahooDateString; // 形式が異なる場合はそのまま返す
  }
  const year = yahooDateString.substring(0, 4);
  const month = yahooDateString.substring(4, 6);
  const day = yahooDateString.substring(6, 8);
  const hour = yahooDateString.substring(8, 10);
  const minute = yahooDateString.substring(10, 12);

  // タイムゾーンはJSTを想定
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`); 
  return Utilities.formatDate(date, 'JST', 'M月d日 H時m分');
}