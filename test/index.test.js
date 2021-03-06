var test = require('tape');
var toJSON = require('../');
var fs = require('fs');
var Stream = require('stream').Stream;
var assertgeojson = require('geojson-assert');
var now = new Date();
var internalErrors = require('../errors');

[
  { name: 'shape', len: 162 },
  { name: 'counties', len: 14 },
  { name: 'senate', len: 40 },
].forEach(function(o) {
  test(o.name + '.zip to json', function(t) {
    var inStream = fs.createReadStream(__dirname + '/../data/' + o.name + '.zip');
    var outStream = new Stream;
    outStream.writable = true;

    var data = '';
    outStream.write = function(buf) {
      data += buf;
    };

    outStream.end = function() {
      var geo = JSON.parse(data);
      t.equal(typeof geo, 'object', 'is object');
      t.equal(geo.features.length, o.len, 'got ' + o.len + ' features');
      t.doesNotThrow(function() { assertgeojson(data); }, 'is valid geojson');
      t.end();
    };

    toJSON(inStream).pipe(outStream);
  });
});


test('combined.zip to json', function(t) {
  var inStream = fs.createReadStream(__dirname + '/../data/combined.zip');
  var outStream = new Stream;
  outStream.writable = true;

  var data = '';
  outStream.write = function(buf) {
    data += buf;
  };

  outStream.end = function() {
    var geos = JSON.parse(data);
    t.equal(typeof geos, 'object', 'is object');
    t.equal(Array.isArray(geos), true, 'is array');

    t.equal(geos.length, 2, 'got 2 features');

    var expected = [14, 40];
    for (var i; i < geos.length; i++) {
      var geo = geos[i];
      t.equal(geo.features.length, expected[i], 'got ' + expected[i] + ' features');
      t.doesNotThrow(function() { assertgeojson(data); }, 'is valid geojson');
    }
    t.end();
  };

  toJSON(inStream).pipe(outStream);
});


test('skipRegExes - combined.zip to json', function(t) {
  var inStream = fs.createReadStream(__dirname + '/../data/combined.zip');
  var outStream = new Stream;
  outStream.writable = true;

  var data = '';
  outStream.write = function(buf) {
    data += buf;
  };

  outStream.end = function() {
    var geos = [JSON.parse(data)];

    t.equal(typeof geos, 'object', 'is object');
    t.equal(Array.isArray(geos), true, 'is array');

    t.equal(geos.length, 1, 'got 1 features');

    var expected = [40];
    for (var i; i < geos.length; i++) {
      var geo = geos[i];
      t.equal(geo.features.length, expected[i], 'got ' + expected[i] + ' features');
      t.doesNotThrow(function() { assertgeojson(data); }, 'is valid geojson');
    }
    t.end();
  };

  toJSON(inStream, { skipRegExes: [/counties/i] }).pipe(outStream);
});

test('alwaysReturnArray && skipRegExes - combined.zip to json', function(t) {
  var inStream = fs.createReadStream(__dirname + '/../data/combined.zip');
  var outStream = new Stream;
  outStream.writable = true;

  var data = '';
  outStream.write = function(buf) {
    data += buf;
  };

  outStream.end = function() {
    var geos = JSON.parse(data);
    t.equal(typeof geos, 'object', 'is object');
    t.equal(Array.isArray(geos), true, 'is array');

    t.equal(geos.length, 1, 'got 1 features');

    var expected = [40];
    for (var i; i < geos.length; i++) {
      var geo = geos[i];
      t.equal(geo.features.length, expected[i], 'got ' + expected[i] + ' features');
      t.doesNotThrow(function() { assertgeojson(data); }, 'is valid geojson');
    }
    t.end();
  };

  toJSON(inStream, {
    alwaysReturnArray: true,
    skipRegExes: [/counties/i]
  }).pipe(outStream);
});

test("errors exist", function(t) {
  t.equal(Object.keys(toJSON.errors).length, Object.keys(internalErrors).length);
  t.end();
});


test("end", function(t) {
  console.log("total time: ");
  console.log(new Date() - now);
  t.end();
});
