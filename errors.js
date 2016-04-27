var util = require('util');

function NoShapeFilesError(message) {
  Error.call(this);
  this.message = message;
}

function NoSpecificShapeFileError(message) {
  Error.call(this);
  this.message = message;
}

function UnzipError(message) {
  Error.call(this);
  this.message = message;
}

[
  NoSpecificShapeFileError,
  NoShapeFilesError,
  UnzipError
].forEach(function(classz) {
  util.inherits(classz, Error);
});


module.exports = {
  NoShapeFilesError: NoShapeFilesError,
  NoSpecificShapeFileError: NoSpecificShapeFileError,
  UnzipError: UnzipError
};
