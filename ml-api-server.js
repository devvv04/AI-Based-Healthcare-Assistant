const express = require('express');
const cors = require('cors');
const { predictDisease } = require('./ai-models/diagnosis.js');
const diseases = require('./ai-models/disease_symptoms.js');

const app = express();
app.use(cors());
app.use(express.json());

// Add /symptoms endpoint to return all known symptoms
app.get('/symptoms', (req, res) => {
  // Aggregate all unique symptoms from diseases
  const allSymptomsSet = new Set();
  Object.values(diseases).forEach(symptomList => {
    symptomList.forEach(symptom => allSymptomsSet.add(symptom.toLowerCase()));
  });
  const allSymptoms = Array.from(allSymptomsSet);
  res.json({ symptoms: allSymptoms });
});

app.post('/predict', (req, res) => {
  const { symptoms } = req.body;
  if (!symptoms || !Array.isArray(symptoms)) {
    return res.status(400).json({ error: 'Symptoms must be an array' });
  }

  const result = predictDisease(symptoms);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  // Add timestamp to result
  result.timestamp = new Date().toISOString();
  res.json(result);
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`ML API server running on port ${PORT}`);
});
