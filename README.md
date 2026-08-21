# Cambodia Food Price Prediction

An AI/ML university project that predicts Cambodia food prices from historical World Food Programme market data.

The project includes:

- A Python notebook for data cleaning, feature engineering, model training, and evaluation
- A trained XGBoost regression model
- A Nuxt 4 web app with API routes
- A Telegram bot webhook that uses the same prediction engine

## Project Goal

The goal is to forecast food prices for a selected commodity and market in Cambodia using:

- Commodity
- Market/location
- Price type
- Month and quarter
- Previous prices
- Recent price trend features

Example:

```text
Commodity: Rice (mixed, low quality)
Market: Phnom Penh
Prediction: Next month

Predicted price:
$0.46 per unit
```

## Dataset

Dataset file:

**WFP Food Prices for Cambodia**

https://data.humdata.org/dataset/wfp-food-prices-for-cambodia

Local CSV:

```text
data/wfp_food_prices_khm.csv
```

The dataset contains historical food price records for different commodities, markets, provinces, price types, and dates in Cambodia.

## Machine Learning

This is a regression problem, so model performance is reported with regression metrics, not classification accuracy.

The notebook compares:

- Naive baseline: predict that the next price equals the previous price
- Random Forest
- XGBoost

Current saved benchmark:

| Model | MAE USD | RMSE USD | R2 |
|---|---:|---:|---:|
| Naive baseline | 0.1799 | 0.4088 | 0.9239 |
| Random Forest | 0.1690 | 0.3352 | 0.9489 |
| XGBoost final model | 0.1641 | 0.3303 | 0.9504 |

The final XGBoost model has an average error of about **$0.16** and explains about **95%** of the variation in the held-out test data.

## Forecast Horizon Benchmark

The notebook also includes a 1-12 month benchmark section. This compares how the saved model performs when predicting 1 month ahead, 2 months ahead, and so on up to 12 months ahead.

This matters because a model can perform well for the next period but become less reliable as the forecast horizon gets longer.

The current 1-12 month benchmark shows errors around **$0.20 per unit**, with R2 usually above **0.93**.

## ML Workflow

```text
WFP Cambodia Dataset
        |
        v
Data Cleaning
        |
        v
Feature Engineering
        |
        v
Time-Based Train/Test Split
        |
        v
Baseline, Random Forest, XGBoost
        |
        v
Model Evaluation
        |
        v
Export Model Artifacts
        |
        v
Nuxt API + Web App + Telegram Bot
```

## Model Artifacts

The notebook saves Python pickle files in:

```text
model_artifacts/model_artifacts/
```

Important files:

```text
price_model.pkl
encoders.pkl
feature_cols.pkl
```

The Nuxt app does not load these pickle files directly. Instead, `tools/export_artifacts.py` converts them into JSON files:

```text
nuxt-app/server/assets/artifacts/model.json
nuxt-app/server/assets/artifacts/encoders.json
nuxt-app/server/assets/artifacts/feature_cols.json
nuxt-app/server/assets/artifacts/history.json
```

Those JSON files are what the deployed app uses on Vercel.

## Web Application

The deployed app is built with:

- Nuxt 4
- Vue 3
- TypeScript
- Nitro server routes
- Hand-built SVG chart
- Vercel deployment

The app supports:

- Commodity and market selection
- Price forecast
- Historical price chart
- Clear warning when the latest data for a series is old
- API routes for web and Telegram usage

## Telegram Bot

The Telegram bot uses the Nuxt API webhook route.

Commands include:

```text
/start
/help
/predict <commodity> <market>
/commodities
/markets
```

Example:

```text
/predict rice phnom penh
```

## Run the Nuxt App

Deploy or run from the `nuxt-app` folder:

```bash
cd nuxt-app
npm install
npm run dev
```

For Vercel, set the project root directory to:

```text
nuxt-app
```

## Testing

From `nuxt-app`:

```bash
npm test
```

The test suite checks that the TypeScript prediction engine matches the Python model's prediction for a known reference case.

## Current Project Structure

```text
food-price-prediction/
|
|-- data/
|   |-- wfp_food_prices_khm.csv
|-- notebooks/
|   |-- cambodia_food_price_prediction.ipynb
|-- reports/
|   |-- Cambodia_Food_Price_Forecast.pdf
|   |-- Cambodia_Food_Price_Forecast.pptx
|-- docs/
|   |-- prompt.md
|-- model_artifacts/
|   |-- model_artifacts/
|   |   |-- price_model.pkl
|   |   |-- encoders.pkl
|   |   |-- feature_cols.pkl
|   |-- model_artifacts.zip
|-- tools/
|   |-- build_slides.py
|   |-- export_artifacts.py
|   |-- metrics.json
|-- nuxt-app/
|   |-- app/
|   |-- server/
|   |   |-- api/
|   |   |-- assets/artifacts/
|   |   |-- utils/
|   |-- test/
|   |-- package.json
|-- README.md
```

## Course Context

```text
Course: Artificial Intelligence
Project: Cambodia Food Price Prediction
AI Task: Regression / time-series style forecasting
Dataset: WFP Cambodia Food Prices
Frontend: Nuxt 4 / Vue 3
Bot: Telegram webhook
Deployment: Vercel
```

## Disclaimer

Predictions are model estimates based on historical data. They are not official market prices. If a commodity-market series has old data, the forecast should be treated as less reliable.
