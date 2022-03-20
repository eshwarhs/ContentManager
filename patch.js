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
  if (!("active" in body) || (body["active"] != true && body["active"] != false)) {
    return "Invalid/Missing values for key - active. Must be either true/false"
  }
}

module.exports.patchContent = async (event) => {

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

  // console.log("Asset value " + is_asset);
  // console.log("Stream value " + is_stream);

  const new_active = "active" in body && body["active"] == true ? 1 : 0;

  if (is_asset) {
    const get_prev_asset_active_sql = "SELECT * from known_asset where ref_id='" + body["ref_id"] + "'";
    try {
      let results = await mysql.query(get_prev_asset_active_sql);
      await mysql.end();
      const asset_id = results[0].id;
      const prev_active = results[0].is_active;

      const get_file_date_sql = "SELECT * from fingerprints where known_asset_id=" + asset_id;
      let results1 = await mysql.query(get_file_date_sql);
      await mysql.end();

      const file_data = results1[0].fingerprints;
      const meta_data = "metadata" in body ? body["metadata"] : results[0].meta_data;
      const update_asset_sql = "UPDATE known_asset set is_active=" + new_active + ",meta_data='" + meta_data + "' where ref_id='" + body["ref_id"] + "'"
      results = await mysql.query(update_asset_sql);
      await mysql.end();

      const s3 = new AWS.S3();

      if (prev_active == 1 && new_active == 0) {
        console.log("Delete file!!!!!");

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
      else if (prev_active == 0 && new_active == 1) {
        console.log("Create file!!!!!!");

        const params = {
          Bucket: config.s3Bucket,
          Key: "asset_" + asset_id + '.bin',
          Body: Buffer.from(file_data, 'base64').toString('binary')
        };
        await s3.upload(params).promise().then(function (data) {
          console.log(`File uploaded successfully. ${data.Location}`);
        }, function (err) {
          console.error("Upload failed", err);
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
    try {
      const update_stream_sql = "UPDATE known_stream set is_active=" + new_active + " where ref_id='" + body["ref_id"] + "'"
      console.log(update_stream_sql);
      let results = await mysql.query(update_stream_sql);
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
        message: "Content updated successfully!"
      },
      null,
      2
    ),
  }
}