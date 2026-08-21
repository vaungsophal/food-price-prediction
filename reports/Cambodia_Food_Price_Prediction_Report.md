# American University of Phnom Penh

# School of Digital Technologies

# ITM-390 Machine Learning

# Final Project Report

## Project Information

| Field         | Information                                                  |
| ------------- | ------------------------------------------------------------ |
| Project title | Cambodia Food Price Prediction                               |
| Khmer title   | ការព្យាករណ៍តម្លៃអាហារនៅកម្ពុជា |
| Course        | AI                                                           |
| Department    | School of Digital Technologies                               |
| Advisor       | [Advisor Name]                                               |
| Team          | [Group / Team Name]                                          |

## Team Members

| Role     | Name   | Student ID   |
| -------- | ------ | ------------ |
| Member 1 | [Name] | [Student ID] |
| Member 2 | [Name] | [Student ID] |

ITM 390 - Machine Learning Final Project Report

---

## I. Introduction

Food prices are an important daily concern for households, students, vendors, and small buyers in Cambodia. A small change in the price of rice, eggs, pork, vegetables, or cooking oil can affect monthly spending and market planning. Public food price records are available, but most of the data exists as large datasets that are difficult for ordinary users to interpret directly.

The World Food Programme (WFP) food price dataset for Cambodia provides historical records across many commodities and markets. These records include date, province, market, commodity, price type, unit, local price, and USD price. However, the dataset mainly tells users what already happened. The main problem addressed by this project is how to turn historical market data into a simple forecasting tool that can estimate the next food price for a selected commodity and market.

This project proposes a machine learning system that predicts Cambodia food prices using historical WFP market data. The system uses regression models to forecast USD food prices from recent price behavior, calendar features, commodity identity, market identity, province, category, and price type. The final model is an XGBoost regression model that is exported into JSON and served through a Nuxt web application.

The hypothesis of this study is:

> Recent price history and market information can be used to forecast Cambodia food prices accurately enough to support planning and public awareness.

This project contributes:

- A cleaned and feature-engineered food price dataset for Cambodia.
- A chronological machine learning experiment for price forecasting.
- A comparison between a naive baseline, Random Forest, and XGBoost.
- A lightweight deployment approach that ports the trained XGBoost model to TypeScript.
- A user-facing web application and API for food price prediction.

---

## II. Literature Review

This section presents related work grouped into three themes: food price forecasting, time-series machine learning, and deployable machine learning applications.

### A. Food Price Forecasting

Food price forecasting is commonly used for market monitoring, food security analysis, and early warning systems. Organizations such as the World Food Programme collect food price data to help understand affordability and market stability. Previous research often uses historical price records, seasonal patterns, and external indicators such as rainfall, fuel cost, currency exchange rates, and production levels.

Gap: Many public datasets are available, but they are not always converted into tools that ordinary users can access.

Relevance: This project uses WFP Cambodia food price data and turns it into a prediction system with a web interface.

### B. Time-Series Machine Learning

Classical time-series forecasting often uses models such as ARIMA and exponential smoothing. Machine learning approaches, including Random Forest and gradient boosting, can also perform well when the data is transformed into supervised learning features such as lag values, rolling means, month, and quarter.

Tree-based models are useful because they can handle non-linear relationships and mixed feature types. XGBoost is especially popular for tabular regression tasks because it builds an ensemble of boosted decision trees and often performs strongly with engineered features.

Gap: Random train/test splits can produce misleading results for time-based data because the model may learn from the future.

Relevance: This project uses a chronological train/test split so the model is evaluated on later dates that were not seen during training.

### C. Deployable Machine Learning Systems

Many machine learning projects remain inside notebooks and are difficult to deploy because their dependencies are large. Python packages such as XGBoost, NumPy, pandas, SciPy, and scikit-learn can exceed free serverless deployment limits. A practical system must balance model quality with deployment size, speed, and maintainability.

Gap: A trained model may work well in a notebook but fail to become a usable product if it requires heavy runtime dependencies.

Relevance: This project exports the trained XGBoost model into JSON and reimplements only the inference logic in TypeScript, allowing the deployed application to avoid Python ML dependencies.

---

## III. Methodology

This section explains the system architecture, dataset, feature engineering, and machine learning workflow.

### A. System Architecture

The proposed system consists of four major components:

1. Dataset and notebook

   - Loads the WFP Cambodia food price CSV.
   - Cleans and filters the data.
   - Builds time-series features.
   - Trains and evaluates regression models.
2. Machine learning model

   - Uses recent price history and categorical information.
   - Compares a naive lag baseline, Random Forest, and XGBoost.
   - Selects XGBoost as the final model.
3. Model artifact export

   - Converts the trained XGBoost model into JSON.
   - Exports encoder maps, feature order, and recent price history.
   - Produces files used directly by the Nuxt server.
4. Product interface

   - Nuxt web app for browser users.
   - API routes for prediction and options.

### B. Research Flowchart

```text
WFP Cambodia Food Price Dataset
        |
        v
Data Cleaning and Filtering
        |
        v
Feature Engineering
        |
        v
Chronological Train/Test Split
        |
        v
Train Baseline, Random Forest, and XGBoost
        |
        v
Evaluate Regression Metrics
        |
        v
Export Model Artifacts to JSON
        |
        v
Nuxt Web App + API
```

### C. Dataset Description

| Item            | Description                                   |
| --------------- | --------------------------------------------- |
| Source          | World Food Programme food prices for Cambodia |
| Local file      | `data/wfp_food_prices_khm.csv`              |
| Raw rows        | 85,107                                        |
| Raw date range  | 2003-01-15 to 2026-03-15                      |
| Raw commodities | 50                                            |
| Raw markets     | 86                                            |
| Target column   | `usdprice`                                  |
| Prediction task | Regression                                    |

The dataset contains historical food price records for different commodities, markets, provinces, categories, units, currencies, and price types. The project focuses on USD price prediction because it gives a consistent target value across the dataset.

### D. Dataset Preparation

The preparation process includes:

- Load the raw CSV using pandas.
- Parse the `date` column as a date value.
- Filter records from 2019 onward to focus on more recent reporting.
- Keep commodities with at least 300 records.
- Sort observations by commodity, market, price type, and date.
- Build lag and rolling features within each time series.
- Drop rows without enough previous observations.
- Encode categorical columns using label encoders.

After filtering and feature construction, the modeled dataset contains:

| Item            |  Value |
| --------------- | -----: |
| Modeled rows    | 67,654 |
| Training rows   | 57,878 |
| Test rows       |  9,776 |
| Series          |  3,280 |
| App commodities |     46 |
| App markets     |     76 |

### E. Feature Engineering

The model uses ten features:

| Feature            | Meaning                                         |
| ------------------ | ----------------------------------------------- |
| `commodity_enc`  | Encoded commodity name                          |
| `market_enc`     | Encoded market name                             |
| `admin1_enc`     | Encoded province                                |
| `category_enc`   | Encoded food category                           |
| `pricetype_enc`  | Encoded price type, such as retail or wholesale |
| `month`          | Month being forecast                            |
| `quarter`        | Quarter being forecast                          |
| `lag_1`          | Previous recorded price in the same series      |
| `lag_3`          | Price three records before in the same series   |
| `rolling_mean_3` | Mean of the last three recorded prices          |

Lag features are calculated inside each commodity-market-price type series. This prevents data leakage between unrelated series, such as rice prices in one market affecting pork prices in another market.

### F. Machine Learning Models

Three models were compared:

1. Naive baseline

   - Predicts that the next price is equal to the previous price.
   - This is a strong baseline because food prices are often sticky.
2. Random Forest Regressor

   - Uses multiple decision trees.
   - Handles non-linear relationships in tabular data.
3. XGBoost Regressor

   - Uses boosted decision trees.
   - Selected as the final model because it achieved the best test performance.

---

## IV. Experiments

### A. Experimental Setup

| Component          | Description                                          |
| ------------------ | ---------------------------------------------------- |
| Environment        | Python, pandas, scikit-learn, XGBoost, Jupyter/Colab |
| Dataset size       | 67,654 modeled rows                                  |
| Train/test method  | Chronological split                                  |
| Split date         | 2025-04-15                                           |
| Training rows      | 57,878                                               |
| Test rows          | 9,776                                                |
| Input features     | 10 engineered features                               |
| Output             | USD food price                                       |
| Evaluation metrics | MAE, RMSE, R2                                        |

### B. Training Process

1. Load the WFP Cambodia food price dataset.
2. Filter and clean the records.
3. Group data by commodity, market, and price type.
4. Generate lag and rolling mean features.
5. Encode categorical variables.
6. Split the dataset chronologically.
7. Train the naive baseline, Random Forest, and XGBoost models.
8. Evaluate each model on the held-out test period.
9. Save the final model, encoders, and feature columns.
10. Export model artifacts to JSON for the Nuxt application.

### C. Deployment Experiment

The project also tested whether the trained model could be deployed as a practical application. A direct deployment with Python ML dependencies is too large for a low-cost serverless setup. To solve this, the XGBoost model is converted into JSON arrays containing tree structure, thresholds, leaf weights, encoder mappings, and feature order.

The TypeScript prediction engine performs the same inference process by walking through each tree, summing leaf weights, and adding the base score. This keeps the deployed application small while preserving the trained model behavior.

### D. Verification Testing

The Nuxt application includes a Vitest test suite. The most important test compares the TypeScript model output with the Python XGBoost model output for a known reference case:

| Field                 | Value                     |
| --------------------- | ------------------------- |
| Commodity             | Rice (mixed, low quality) |
| Market                | Phnom Penh                |
| Price type            | Wholesale                 |
| Last recorded date    | 2022-06                   |
| Last recorded price   | 0.44 USD                  |
| Python prediction     | 0.458068                  |
| TypeScript prediction | 0.458068                  |

The test ensures that the deployed TypeScript inference logic matches the original Python model to within floating point tolerance.

---

## V. Results

### A. Model Performance

| Model                  | MAE (USD) | RMSE (USD) |     R2 |
| ---------------------- | --------: | ---------: | -----: |
| Naive baseline (lag_1) |    0.1799 |     0.4088 | 0.9239 |
| Random Forest          |    0.1690 |     0.3352 | 0.9489 |
| XGBoost final model    |    0.1641 |     0.3303 | 0.9504 |

The final XGBoost model achieved the best result, with an average error of about 0.164 USD on the held-out test period. It also explained about 95.0% of the variation in the test data.

Compared with the naive baseline, the XGBoost model reduced MAE from 0.1799 to 0.1641. This shows that the model learned useful information beyond simply repeating the last recorded price.

### B. Feature Importance

| Feature            | Importance |
| ------------------ | ---------: |
| `rolling_mean_3` |      68.2% |
| `lag_1`          |      29.9% |
| `category_enc`   |       0.4% |
| `commodity_enc`  |       0.4% |
| `lag_3`          |       0.3% |
| `quarter`        |       0.2% |
| `month`          |       0.2% |
| `pricetype_enc`  |       0.2% |
| `admin1_enc`     |       0.1% |
| `market_enc`     |       0.1% |

The result shows that recent price behavior is the most important signal. The model depends mainly on `rolling_mean_3` and `lag_1`, meaning it acts as a strong price smoother. Commodity, market, province, and seasonal variables still help, but their contribution is much smaller.

### C. Application Result

The final system is not only a notebook model. It is also available through:

- A Nuxt 4 web application.
- `/api/options` for commodity and market options.
- `/api/predict` for food price forecasting.
- A deployed web interface for selecting commodities and markets.

The user can select a commodity and market in the browser, view the latest recorded price, see the predicted next price, and inspect recent historical prices on a chart.

---

## VI. Discussion

The experimental results support the hypothesis that recent historical prices and market information can forecast Cambodia food prices with useful accuracy. The final XGBoost model performs better than both the naive baseline and Random Forest, reaching an R2 score of 0.9504.

### Why the Model Performed Well

- Food prices are autocorrelated, so recent prices are strong predictors.
- Rolling average features reduce noise from individual price changes.
- XGBoost handles non-linear patterns in tabular data.
- The chronological split gives a realistic evaluation of future prediction.
- Categorical encodings help the model separate commodities, markets, provinces, and price types.

### Observed Strengths

- Strong test performance with MAE around 0.164 USD.
- Uses public WFP data instead of manually collected private data.
- Provides a real product interface, not only a notebook.
- Lightweight TypeScript inference avoids large Python ML dependencies in deployment.
- API routes make the same model available to the web interface and external clients.

### Limitations

- The model relies heavily on recent prices and may not predict sudden market shocks.
- External factors such as rainfall, fuel price, holidays, exchange rate, and import supply are not included.
- Some commodity-market series have old last observations, so their forecasts are less reliable.
- Label encoding treats categorical values as numbers, which may not fully represent relationships between categories.
- The model gives point predictions only and does not provide prediction intervals.

### Future Work

- Add external variables such as rainfall, fuel prices, exchange rates, and holiday indicators.
- Add prediction intervals to show uncertainty.
- Compare additional models such as LightGBM, CatBoost, LSTM, or temporal deep learning models.
- Schedule monthly retraining when new WFP data becomes available.
- Improve the web app with clearer stale-data warnings and downloadable forecast summaries.
- Add Khmer language support for the web interface.

---

## VII. Conclusion

This study developed a machine learning system for predicting Cambodia food prices using historical World Food Programme market data. The project transformed raw food price records into a supervised regression dataset using lag features, rolling means, calendar features, and encoded market information.

The final XGBoost model achieved the best performance, with MAE of 0.1641 USD, RMSE of 0.3303 USD, and R2 of 0.9504 on a chronological held-out test set. These results show that the model can forecast food prices more accurately than a naive last-price baseline.

The main contribution of this project is the complete pipeline from data science to product deployment. The trained model is exported into JSON and served through a Nuxt web application and API routes. This makes the forecast accessible to users without requiring them to open a dataset or run a notebook.

Overall, the project demonstrates how public food price data can become a practical AI tool for market awareness, planning, and learning. The system is a credible forecasting prototype, while still requiring caution because predictions are estimates and not official market prices.

---

## VIII. References

[1] World Food Programme, "Food Prices for Cambodia," Humanitarian Data Exchange.

[2] T. Chen and C. Guestrin, "XGBoost: A Scalable Tree Boosting System," Proceedings of the 22nd ACM SIGKDD International Conference on Knowledge Discovery and Data Mining, 2016.

[3] L. Breiman, "Random Forests," Machine Learning, vol. 45, pp. 5-32, 2001.

[4] F. Pedregosa et al., "Scikit-learn: Machine Learning in Python," Journal of Machine Learning Research, vol. 12, pp. 2825-2830, 2011.

[5] W. McKinney, "Data Structures for Statistical Computing in Python," Proceedings of the 9th Python in Science Conference, 2010.

[6] G. E. P. Box, G. M. Jenkins, G. C. Reinsel, and G. M. Ljung, Time Series Analysis: Forecasting and Control, Wiley, 2015.

[7] Nuxt Team, "Nuxt Documentation," Nuxt.

[8] Vercel, "Vercel Documentation," Vercel.
