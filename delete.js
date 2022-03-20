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
  if (!("ref_id" in body)) {
    return "Invalid or missing values for key - ref_id";
  }
}

module.exports.deleteContent = async (event) => {

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

  const body = JSON.parse(event.body);

  if (body != null) {
    const val_body = validate_payload(body);
    if (val_body != null) {
      console.log(val_body);
      return {
        statusCode: 400,
        body: JSON.stringify(
          {
            message: val_body
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

  var is_asset = -1;
  var is_stream = -1;
  try {
    const sql_get_known = "SELECT * from known where ref_id='" + body["ref_id"] + "'";
    let results = await mysql.query(sql_get_known);
    await mysql.end()
    if (results.length == 0) {
      return {
        statusCode: 404,
        body: JSON.stringify(
          {
            message: "ref_id does not exist"
          },
          null,
          2
        ),
      }
    }
    is_asset = results[0].is_asset;
    is_stream = results[0].is_stream;
  }
  catch (e) {
    console.log("Error when executing SQL query.");
    console.log(e);
    return sql_error;
  }

  if (is_asset) {
    console.log("Delete asset");
    const get_asset = "SELECT * from known_asset where ref_id='" + body["ref_id"] + "'";
    const s3 = new AWS.S3();
    try {
      let results = await mysql.query(get_asset);
      await mysql.end();
      const asset_id = results[0].id;
      const prev_active = results[0].is_active;

      const del_fingerprint = "DELETE from fingerprints where known_asset_id=" + asset_id
      const del_known_asset = "DELETE from known_asset where ref_id='" + body["ref_id"] + "'";
      const del_known = "DELETE from known where ref_id='" + body["ref_id"] + "'";
      await mysql.query(del_fingerprint);
      await mysql.query(del_known_asset);
      await mysql.query(del_known);
      await mysql.end();

      if (prev_active) {
        const params = {
          Bucket: config.s3Bucket,
          Key: "asset_" + asset_id + '.bin'
        };
        await s3.deleteObject(params).promise().then(function (data) {
          console.log(`File deleted successfully. ${data.Location}`);
        }, function (err) {
          console.error("Delete failed", err);
        });
      }
    }
    catch (e) {
      console.log("Error when executing SQL query.");
      console.log(e);
      return sql_error;
    }
  }
  else if (is_stream) {
    console.log("Delete stream");
    try {
      const del_known_stream = "DELETE from known_stream where ref_id='" + body["ref_id"] + "'";
      const del_known = "DELETE from known where ref_id='" + body["ref_id"] + "'";
      await mysql.query(del_known_stream);
      await mysql.query(del_known);
      await mysql.end();
    }
    catch (e) {
      console.log("Error when executing SQL query.");
      console.log(e);
      return sql_error;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: "Content deleted successfully!"
      },
      null,
      2
    ),
  }
}