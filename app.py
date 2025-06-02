from flask import Flask, request, jsonify
import os
import logging

# ロギング設定 (Renderのログで確認しやすくするため)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

@app.route('/')
def hello():
    logger.info("Root path '/' was accessed.")
    return "🎉 Hello from your Slack Bot on Render! 🎉"

# SlackのEvent Subscriptionsで設定するRequest URL用のエンドポイント
@app.route('/slack/events', methods=['POST'])
def slack_events():
    data = request.json
    logger.info(f"Received event: {data.get('type')}") # イベントタイプをログに出力

    # SlackのURL検証リクエストへの対応 (初回設定時に必要)
    if data and data.get('type') == 'url_verification':
        logger.info("Responding to URL verification challenge.")
        return jsonify({'challenge': data.get('challenge')})

    # ここに今後、ボットへのメンションなどのイベントを処理するロジックを記述します
    # (例: Groq API呼び出し、Slackへの返信など)

    # Slack APIは3秒以内に応答を期待するため、まずは200 OKを返す
    return "OK", 200

if __name__ == "__main__":
    # この部分はRender環境ではGunicornがWSGIサーバーとして起動するため直接は使われませんが、
    # ローカルでのテスト実行のために残しておくと便利です。
    # Renderは環境変数 PORT でリッスンすべきポートを指定します。
    port = int(os.environ.get('PORT', 3000))
    logger.info(f"Starting Flask app locally on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
