'use strict';
const config = require('./config.json');

const mysql = require('serverless-mysql')({
  config: {
    host: config.host,
    user: config.user,
    password: config.password,
    database: config.database
  }
});
const multipart = require('aws-lambda-multipart-parser');
const AWS = require('aws-sdk');

const sql_error = {
  statusCode: 400,
  body: JSON.stringify(
    {
      message: "Error when performing SQL operation."
    },
    null,
    2
  ),
};

async function validate_user(headers) {
  if (headers["access-key"] == null) {
    return "Missing access-key header/value"
  }
  if (headers["secret-key"] == null) {
    return "Missing secret-key header/value"
  }
  const sql = "select * from known_producer where access_key='" + headers["access-key"] + "' and secret_key='" + headers["secret-key"] + "'";
  try {
    let results = await mysql.query(sql);
    await mysql.end()
    if (results.length == 0)
      return "User not found";
    return results[0].id;
  }
  catch (e) {
    console.log("Error when executing SQL query.");
    return sql_error;
  }
}

function validate_payload(body) {
  if (!("type" in body) || (body["type"].toLowerCase() != "asset" && body["type"].toLowerCase() != "stream")) {
    return "Invalid or missing values for key - type";
  }
  if (!("ref_id" in body)) {
    return "Invalid or missing values for key - ref_id";
  }
  if (body["type"].toLowerCase() == "asset") {
    if (!("asset_type" in body))
      return "Missing value for key - asset_type";
    if (!("duration" in body))
      return "Missing value for key - duration";
    if (typeof (body["duration"]) != "number")
      return "Invalid value for key - duration. Must be integer"
    if (body["asset_type"].toUpperCase() == "VOD" && !("asset_source" in body))
      return "Missing value for key - asset_source"
  }
  if (body["type"].toLowerCase() == "stream") {
    if (!("station_id" in body))
      return "Missing value for key - station_id"
    if (typeof (body["station_id"]) != "number")
      return "Invalid value for key - station_id. Must be integer"
    if (!("dma_id" in body))
      return "Missing value for key - dma_id"
    if (typeof (body["dma_id"]) != "number")
      return "Invalid value for key - dma_id. Must be integer"
  }
  if ("active" in body && typeof (body["active"]) != "boolean")
    return "Invalid values for key - active. Must be either true/false"
}

module.exports.postContent = async (event) => {

  const headers = event['headers'];
  const val_errors = await validate_user(headers);
  if (typeof (val_errors) == "string" && (val_errors.includes("Missing") || val_errors.includes("not"))) {
    return {
      statusCode: 400,
      body: JSON.stringify(
        {
          message: "Unauthorized User"
        },
        null,
        2
      ),
    }
  }

  const res = multipart.parse(event, false);
  var body = "";
  if ("data" in res) {
    body = res['data'];
    body = JSON.parse(body);
    const val_payload = validate_payload(body);
    if (val_payload != null) {
      console.log(val_payload);
      return {
        statusCode: 400,
        body: JSON.stringify(
          {
            message: val_payload
          },
          null,
          2
        ),
      };
    }
    if (body["type"].toLowerCase() == "asset" && !("file" in res)) {
      return {
        statusCode: 400,
        body: JSON.stringify(
          {
            message: "Missing file in payload."
          },
          null,
          2
        ),
      };
    }
  }
  else {
    return {
      statusCode: 400,
      body: JSON.stringify(
        {
          message: "Invalid Payload"
        },
        null,
        2
      ),
    }
  }

  const is_asset = body["type"].toLowerCase() == "asset" ? 1 : 0;
  const is_stream = body["type"].toLowerCase() == "stream" ? 1 : 0;

  var known_asset_id = -1;

  const meta_data = "metadata" in body ? body["metadata"] : "";
  const is_active = "active" in body && body["active"] == false ? 0 : 1;
  const asset_source = body["type"].toLowerCase() == "asset" && body["asset_type"].toUpperCase() == "VOD" ? body["asset_source"] : "";

  let results = '';
  try {
    const check_sql = "SELECT * from known where ref_id='" + body["ref_id"] + "'";
    results = await mysql.query(check_sql);
    if (results.length != 0) {
      return {
        statusCode: 400,
        body: JSON.stringify(
          {
            message: "ref_id already exists"
          },
          null,
          2
        ),
      }
    }
    const sql1 = "INSERT into known(ref_id,is_asset,is_stream,producer_id) values('" + body["ref_id"] + "'," + is_asset + "," + is_stream + "," + val_errors + ")";
    results = await mysql.query(sql1);
    await mysql.end();
  }
  catch (e) {
    console.log("Error when executing SQL query.");
    return sql_error;
  }

  if (is_asset) {
    try {
      const sql_asset = "INSERT into known_asset(ref_id,meta_data,asset_type,asset_source,is_active,duration) values('" + body["ref_id"] + "','" + meta_data + "','" + body["asset_type"] + "','" + asset_source + "'," + is_active + "," + body["duration"] + ")";
      results = await mysql.query(sql_asset);
      await mysql.end();
      known_asset_id = results.insertId;

      var file = res['file'];
      var encodedFile = Buffer.from(file["content"], 'binary').toString('base64');

      const sql_fingerprint = "INSERT into fingerprints(fingerprints,known_asset_id) values('" + encodedFile + "'," + known_asset_id + ")"
      results = await mysql.query(sql_fingerprint);
      await mysql.end();
    }
    catch (e) {
      console.log("Error when executing SQL query.");
      return sql_error;
    }

    if (is_active) {
      const s3 = new AWS.S3();

      const params = {
        Bucket: config.s3Bucket,
        Key: "asset_" + known_asset_id + '.bin',
        Body: encodedFile
      };

      await s3.upload(params).promise().then(function (data) {
        console.log(`File uploaded successfully. ${data.Location}`);
      }, function (err) {
        console.error("Upload failed", err);
      });
    }
  }
  else if (is_stream) {
    try {
      const sql_stream = "INSERT into known_stream(ref_id,station_id,dma_id,is_active) values ('" + body["ref_id"] + "'," + body["station_id"] + "," + body["dma_id"] + "," + is_active + ")";
      results = await mysql.query(sql_stream);
      await mysql.end();
    }
    catch (e) {
      console.log("Error when executing SQL query.");
      return sql_error;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: "Content saved successfully!"
      },
      null,
      2
    ),
  }
};