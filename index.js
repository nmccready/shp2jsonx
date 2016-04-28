var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var shp = require('shapefile');
var fs = require('fs');
var path = require('path');
var seq = require('seq');
var findit = require('findit');
var duplex = require('duplexify');
var from = require('from2');
var ourErrors = require('./errors');
var xList = null;
var shpFileFromArchive = null;
var shapefileOpts = {};
var skipRegExes = [];
var alwaysReturnArray = null;

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
    if (opts.skipRegExes) {
      skipRegExes = opts.skipRegExes;
    }
    if (opts.alwaysReturnArray !== null && typeof opts.alwaysReturnArray !== "undefined")
      alwaysReturnArray = opts.alwaysReturnArray;
  }
};

module.exports = function(inStream, opts) {
  var id = Math.floor(Math.random() * (1 << 30)).toString(16);
  var tmpDir = path.join('/tmp', id);
  var zipFile = path.join('/tmp', id + '.zip');
  _parseOptions(opts);
  if (shpFileFromArchive)
    shpFileFromArchive = tmpDir + '/' + shpFileFromArchive;

  var outStream = duplex.obj();

  var zipStream = fs.createWriteStream(zipFile);
  inStream.pipe(zipStream);
  zipStream.once('error', outStream.destroy);

  seq()
    .par(function() {
      fs.mkdir(tmpDir, 0700, this);
    })
    .par(function() {
      if (zipStream.closed) this();
      else zipStream.once('close', this);
    })
    .seq_(function(next) {
      // console.log(xList);
      var ps = null;
      if (!xList) {
        ps = spawn('unzip', ['-d', tmpDir, zipFile]);
      } else {
        var toRun = 'unzip ' + zipFile + ' -d ' + tmpDir + ' -x ' + xList;
        ps = exec(toRun);
      }

      ps.once('exit', function(code) {
        next(code < 3 ? null : new ourErrors.UnzipError('error in unzip: code ' + code));
      });
    })
    .seq_(function(next) {
      var s = findit(tmpDir);
      var files = [];

      var onFile = function(file) {
        if (file.match(/__MACOSX/)) return;
        if (file.match(/\.shp$|\.kml$/i)) {
          var index;
          var canPush = true;

          for (index in skipRegExes) {
            if (file.match(skipRegExes[index])) {
              canPush = false;
              break;
            }
          }
          if (canPush)
            files.push(file);
        }
      };

      s.on('file', onFile);
      s.once('end', function() {
        s.removeListener('file', onFile);
        next.ok(files);
      });
    })
    .seq(function(files) {
      if (files.length === 0) {
        this(new ourErrors.NoShapeFilesError('no .shp files found in the archive'));
      } else if (shpFileFromArchive && files.indexOf(shpFileFromArchive) === -1) {
        this(new ourErrors.NoSpecificShapeFileError('shpFileFromArchive: ' + shpFileFromArchive + 'does not exist in archive.'));
      } else {
        if (shpFileFromArchive)
          files = [shpFileFromArchive];

        var maybeArrayBegining = '',
          maybeArrayEnd = '',
          maybeComma = '',
          len = files.length,
          after = '',
          i = 0,
          resultIsArray = alwaysReturnArray !== null ? alwaysReturnArray : len > 1;


        var filePath, isLast, reader, fileName, before, started, firstTime, out;

        function nextFile() {
          if (i >= len) return;
          filePath = files[i];
          // console.log(i);
          // console.log(filePath);
          isLast = i === len - 1;
          if (resultIsArray && i === 0) {
            maybeArrayBegining = '[';
            if (!isLast)
              maybeComma = ',';
          } else
            maybeArrayBegining = '';

          if (isLast && resultIsArray) {
            maybeArrayEnd = ']';
            maybeComma = '';
          }
          // console.log('reading next file: ' +  filePath);
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

        var layerStream = from(function(size, next) {

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
                    // console.log('isLast');
                    return layerStream.push(null);
                  }
                  nextFile();
                  return writeNextFeature();
                }
                // if (!feature) return writeNextFeature();
                // console.log(feature);
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
    .catch(function(err) {
      outStream.destroy(err);
    });
  // return;
  return outStream;
};

module.exports.errors = ourErrors;
