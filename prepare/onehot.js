const fs = require('fs');
const csv = require('csv-parser');

// OBTENER PARÁMETROS DE LA LÍNEA DE COMANDOS
const args = process.argv.slice(2);
if (args.length !== 4) {
  console.error('! ERROR: INPUT, OUTPUT, DICTIONARY AND CONFIG NEEDED !');
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1];
const dictFile = args[2];
const configPath = args[3];

let config = {};

// CARGAR CONFIGURACIÓN DESDE EL ARCHIVO JSON
try {
  const configFile = fs.readFileSync(configPath);
  config = JSON.parse(configFile);
} catch (error) {
  console.error(`! ERROR: NO SE PUDO LEER ${configPath}, USANDO CONFIGURACIÓN POR DEFECTO !`, error);
  process.exit(1);
}

// VARIABLE PARA GESTIONAR #fill# ("none", "zero", "one", "mean", "median")
const fillHandling = config.onehot.fill_transform || "none";

// FUNCIÓN PARA CALCULAR LA MEDIA DE UNA COLUMNA
function calculateMean(column) {
  const numericValues = column.filter(val => !isNaN(val)).map(Number);
  if (numericValues.length === 0) return null;
  const sum = numericValues.reduce((a, b) => a + b, 0);
  return sum / numericValues.length;
}

// FUNCIÓN PARA CALCULAR LA MEDIANA DE UNA COLUMNA
function calculateMedian(column) {
  const numericValues = column.filter(val => !isNaN(val)).map(Number);
  if (numericValues.length === 0) return null;
  numericValues.sort((a, b) => a - b);
  const middle = Math.floor(numericValues.length / 2);
  return numericValues.length % 2 === 0
    ? (numericValues[middle - 1] + numericValues[middle]) / 2
    : numericValues[middle];
}

// FUNCIÓN PARA GESTIONAR EL VALOR #fill#
function handleFill(value, columnValues) {
  if (value === "#fill#") {
    switch (fillHandling) {
      case "zero":
        return 0;
      case "one":
        return 1;
      case "mean":
        return calculateMean(columnValues);
      case "median":
        return calculateMedian(columnValues);
      default:
        return value;
    }
  }
  return value;
}

// FUNCIÓN PARA CREAR UN MAPEADO ÚNICO POR COLUMNA
function stringToNumeric(existingDictionary = {}) {
  const uniqueMapping = existingDictionary;
  let uniqueCounter = Object.keys(uniqueMapping).length;
  const seenValues = new Set(Object.keys(uniqueMapping));
  return (value) => {
    if (!seenValues.has(value)) {
      uniqueMapping[value] = uniqueCounter++;
      seenValues.add(value);
    }
    return uniqueMapping[value];
  };
}

// LEER ARCHIVO CSV
const readCSV = (filePath) => new Promise((resolve, reject) => {
  const results = [];
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => resolve(results))
    .on('error', (error) => reject(error));
});

// GUARDAR ARCHIVO CSV
const saveToCSV = (data, fileName) => {
  const csvContent = [
    Object.keys(data[0]).join(','), 
    ...data.map(row => Object.values(row).map(value => value === null ? 'null' : value).join(','))
  ].join('\n');
  fs.writeFileSync(fileName, csvContent);
  console.log(`[ ONEHOT: ${fileName} ]`);
};

// GUARDAR TODOS LOS DICCIONARIOS EN UN SOLO CSV
const saveDictionary = (dictionaries, dictFileName) => {
  const dictContent = [
    'header,value,key',
    ...Object.entries(dictionaries).flatMap(([header, dictionary]) =>
      Object.entries(dictionary)
        .sort(([, a], [, b]) => a - b)
        .map(([key, value]) => `${header},${key},${value}`)
    )
  ].join('\n');

  fs.writeFileSync(dictFileName, dictContent);
  console.log(`[ DICTIONARY: ${dictFileName} ]`);
};

// LEER DICCIONARIO EXISTENTE DESDE UN SOLO ARCHIVO
const loadExistingDictionary = async (dictFilePath) => {
  const dictionaries = {};
  if (fs.existsSync(dictFilePath)) {
    await new Promise((resolve, reject) => {
      fs.createReadStream(dictFilePath)
        .pipe(csv())
        .on('data', (row) => {
          if (!dictionaries[row.header]) dictionaries[row.header] = {};
          dictionaries[row.header][row.value] = parseInt(row.key, 10);
        })
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });
  }
  return dictionaries;
};

// FUNCIÓN PARA COMPROBAR SI UN VALOR ES NÚMERO
function isNumeric(value) {
  return !isNaN(value) && !isNaN(parseFloat(value));
}

// FUNCIÓN PARA TRANSFORMAR DATOS A CÓDIGOS NUMÉRICOS POR COLUMNA
const transformData = async (inputFilename, dictFilename) => {
  const existingDictionaries = await loadExistingDictionary(dictFilename);
  const data = await readCSV(inputFilename);
  const dictionaries = { ...existingDictionaries };

  // Extraer valores de cada columna para calcular media o mediana
  const columnValues = {};
  data.forEach(row => {
    for (const key in row) {
      if (!columnValues[key]) columnValues[key] = [];
      columnValues[key].push(row[key]);
    }
  });

  const transformedData = data.map(row => {
    const newRow = {};
    for (const key in row) {
      let value = row[key];
      
      // Manejar el valor #fill# usando la función handleFill con los valores de la columna
      value = handleFill(value, columnValues[key]);

      if (!dictionaries[key]) dictionaries[key] = {};

      const getNumericValue = stringToNumeric(dictionaries[key]);

      if (typeof value === 'string' && value.startsWith('\'') && value.endsWith('\'')) {
        const trimmedValue = value.slice(1, -1);
        value = isNumeric(trimmedValue) ? parseFloat(trimmedValue) : getNumericValue(value);
      } else {
        value = getNumericValue(value);
      }
      newRow[key] = value === 'null' ? null : value;
    }
    return newRow;
  });

  return { transformedData, dictionaries };
};

// EJECUTAR PROCESO
transformData(inputFile, dictFile)
  .then(({ transformedData, dictionaries }) => {
    saveToCSV(transformedData, outputFile);
    saveDictionary(dictionaries, dictFile);
  })
  .catch(error => console.error('! ERROR ! ', error));
