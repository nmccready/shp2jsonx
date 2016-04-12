var Promise = require('bluebird');
var spawn = require('child_process')
  .spawn;
var exec = require('child_process')
  .exec;
var shp = require('shapefile');
var fs = Promise.promisifyAll(require('fs'));
var path = require('path');
var findit = require('findit');
var duplex = require('duplexify')
var from2 = require('from2');
var xList = null;
var shpFileFromArchive = null;
var shapefileOpts = {};

var _parseOptions = function(opts) {
  if (opts && typeof(opts) === 'object') {
    if (opts.hasOwnProperty('shpFileFromArchive') && typeof(opts.shpFileFromArchive) === 'string')
      shpFileFromArchive = opts.shpFileFromArchive;
    if (opts.hasOwnProperty('xList')) {
      if (typeof(opts.xList) === 'string')
        xList = opts.xList.replace(/,/g);
      if (Array.isArray(opts.xList))
        xList = opts.xList.join(' ');
    }
    if (opts.hasOwnProperty('ignoreProperties')) {
      if (typeof(opts.ignoreProperties) === 'string')
        shapefileOpts['ignore-properties'] = opts.ignoreProperties === 'true';
      if (typeof(opts.ignoreProperties) === 'boolean')
        shapefileOpts['ignore-properties'] = opts.ignoreProperties;
    }
    if (opts.hasOwnProperty('xList')) {
      if (typeof(opts.encoding) === 'string')
        shapefileOpts.encoding = opts.encoding;
    }
  }
};

var _unzip = function(zipFile, tmpDir, inStream) {
  var zipStream = fs.createWriteStream(zipFile);
  inStream.pipe(zipStream);

  return Promise.all([
      fs.mkdirAsync(tmpDir, 0700),
      new Promise(function(resolve, reject) {

        zipStream.on('error', reject);

        if (zipStream.closed) resolve();
        else zipStream.on('close', resolve);
      })
    ])
    .then(function() {
      return new Promise(function(resolve, reject) {
        // console.log(xList);
        var ps = null;
        if (!xList) {
          ps = spawn('unzip', ['-d', tmpDir, zipFile]);
        } else {
          var toRun = 'unzip ' + zipFile + ' -d ' + tmpDir + ' -x ' + xList;
          ps = exec(toRun);
        }

        ps.on('exit', function(code) {
          code < 3 ? resolve() : reject( new Error('error in unzip: code ' + code))
        });
      });
    });
}

var _filterShapeFiles = function(tmpDir){
  var s = findit(tmpDir);
  var files = [];

  return new Promise(function(resolve, reject) {
    s.on('file', function(file) {
      if (file.match(/__MACOSX/)) return;
      if (file.match(/\.shp$|\.kml$/i)) files.push(file);
    });

    s.on('end', function() {
      resolve(files)
    });
    s.on('error', reject)
  })
}

module.exports = function(inStream, opts) {
  var id = Math.floor(Math.random() * (1 << 30))
    .toString(16);
  var tmpDir = path.join('/tmp', id);
  var zipFile = path.join('/tmp', id + '.zip');

  _parseOptions(opts);

  if (shpFileFromArchive)
    shpFileFromArchive = tmpDir + '/' + shpFileFromArchive;

  var outStream = duplex.obj();

  _unzip(zipFile, tmpDir, inStream)
    .then(_filterShapeFiles.bind(null, tmpDir))
    .then(function(files) {
      //TRANSFORM shp file to geoJson
      //Note: this ugly mess needs to be broken down
      new Promise(function(resolve, reject) {
        if (!files || files.length === 0) {
          reject( new Error('no .shp files found in the archive'));
        } else if (shpFileFromArchive && files.indexOf(shpFileFromArchive) === -1) {
          reject( new Error('shpFileFromArchive: ' + shpFileFromArchive + 'does not exist in archive.'));
        } else {
          if (shpFileFromArchive)
            files = [shpFileFromArchive];

          var maybeArrayBegining = '',
            maybeArrayEnd = '',
            maybeComma = '',
            len = files.length,
            filePath,
            fileName,
            isLast = false,
            reader;

          var isLast, before, started, firstTime, out, after = '', i = 0;

          function nextFile() {

            if (i >= len) return;
            filePath = files[i];

            isLast = i === len - 1;
            if (len > 1 && i === 0) {
              maybeArrayBegining = '[';
              if (!isLast)
                maybeComma = ',';
            } else
              maybeArrayBegining = '';

            if (isLast && len > 1) {
              maybeArrayEnd = ']';
              maybeComma = '';
            }

            reader = shp.reader(filePath, shapefileOpts);
            fileName = filePath;
            for (var toRemove in ['.shp', tmpDir])
              fileName = filePath.replace(toRemove, '');

            before = maybeArrayBegining + '{"type": "FeatureCollection","fileName": "' + fileName + '", "features": [\n';
            after = '\n]}' + maybeComma + '\n' + maybeArrayEnd;
            started = false;
            firstTime = true;

            out = '';

          }

          nextFile();

          var layerStream = from2(function(size, next) {

            writeNextFeature();

            function writeNextFeature() {

              function readRecord() {
                reader.readRecord(function(error, feature) {
                  if (feature == shp.end) {
                    i++;
                    layerStream.push(out);
                    layerStream.push(after);
                    reader.close();
                    if (isLast) {
                      return layerStream.push(null);
                    }
                    nextFile();
                    return writeNextFeature();
                  }

                  var featStr = JSON.stringify(feature);

                  if (started) {
                    featStr = ',\n' + featStr;
                  } else {
                    featStr = before + featStr;
                  }

                  started = true;
                  out += featStr;

                  if (out.length >= size) {
                    next(null, out);
                    out = '';
                  } else {
                    writeNextFeature();
                  }
                });
              };
              if (firstTime) {
                firstTime = false;
                reader.readHeader(function() {
                  readRecord();
                });
              } else readRecord();
            }
          });

          outStream.setReadable(layerStream);
          outStream.end(after);
        }
      })
    })
    .catch(function(err) {
      outStream.destroy(err);
    });

  return outStream;
};
