# 🇰🇭 Cambodia Food Price Prediction

An **AI/ML university project** that predicts future food prices in Cambodia using historical food-price data.

The project trains machine-learning models on Cambodia's food-price dataset and provides predictions through a **Vue 3 web application** and a **Telegram Bot**.

## 🎯 Project Goal

The goal is to study historical food prices in Cambodia and build a machine-learning model that can predict future prices based on factors such as:

* Commodity
* Market/location
* Month and year
* Previous prices
* Historical price trends

Example:

```text
Commodity: Rice
Market: Phnom Penh
Prediction: Next Month

Predicted Price:
3,150 KHR/kg
```

## 📊 Dataset

Dataset used in this project:

**WFP Food Prices for Cambodia**

https://data.humdata.org/dataset/wfp-food-prices-for-cambodia

The dataset contains historical food-price records for different commodities and markets in Cambodia.

## 🤖 Machine Learning

The project explores and compares regression models such as:

* Linear Regression
* Decision Tree
* Random Forest
* XGBoost

Model performance is evaluated using:

* MAE
* RMSE
* R²
* MAPE

The best-performing model will be used for prediction.

## 🧠 ML Workflow

```text
WFP Cambodia Dataset
        ↓
Data Cleaning
        ↓
Exploratory Data Analysis
        ↓
Feature Engineering
        ↓
Model Training
        ↓
Model Evaluation
        ↓
Best Model
        ↓
Prediction API
```

## 🌐 Web Application

The frontend will be built using:

* Vue 3
* TypeScript
* Vite
* Chart.js

The web application will allow users to:

* Predict food prices
* View historical prices
* View price trend charts
* Compare commodities and markets

## 🤖 Telegram Bot

A Telegram Bot will also provide quick food-price predictions.

Example:

```text
/predict

🍚 Food: Rice
📍 Market: Phnom Penh

Predicted Price:
3,150 KHR/kg

Expected Change:
+5%
```

Telegram will communicate with the system using a **webhook API**.

## 🛠 Tech Stack

**Machine Learning**

```text
Python
Pandas
NumPy
Scikit-learn
XGBoost
Matplotlib
```

**Application**

```text
Vue 3
TypeScript
Chart.js
Telegram Bot API
Vercel
```

## 📓 Google Colab

Model development and experimentation:

[Open Cambodia Food Price Prediction Notebook](https://colab.research.google.com/drive/1OsfsIQ0qliCN1_lxWhTuA2CxgxoR2Bi8?authuser=1#scrollTo=fbfd984f)

## 💻 GitHub Repository

https://github.com/vaungsophal/food-price-prediction

## 📁 Current Project Files

```text
food-price-prediction/
│
├── cambodia_food_price_prediction.ipynb
├── wfp_food_prices_khm.csv
└── README.md
```

Future structure:

```text
food-price-prediction/
│
├── data/
├── notebooks/
├── training/
├── models/
├── src/                 # Vue 3
├── api/
│   ├── predict.ts
│   ├── history.ts
│   └── telegram/
│       └── webhook.ts
└── README.md
```

## 🚀 Final Architecture

```text
Cambodia Food Price Dataset
          ↓
     Python Training
          ↓
    Trained ML Model
          ↓
     Prediction API
        ↙       ↘
   Vue 3       Telegram
 Dashboard       Bot
```

## 🎓 Course Context

**Course:** Artificial Intelligence
**Project:** Cambodia Food Price Prediction
**AI Task:** Regression / Time-Series Prediction
**Dataset:** WFP Cambodia Food Prices
**Frontend:** Vue 3
**Bot:** Telegram
**Deployment:** Vercel

## ⚠️ Disclaimer

Predictions are estimates generated from historical data and machine-learning models. They should not be considered official market prices.
