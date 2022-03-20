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
    if (!("content_type" in body))
      return "Missing query parameter - content_type"
    else if ("content_type" in body && body["content_type"].toLowerCase() != "asset" && body["content_type"].toLowerCase() != "stream")
      return "content_type must be either asset or stream"
    if (!("offset" in body))
      return "Missing query parameter - offset"
    else if (isNaN(parseInt(body["offset"])))
      return "offset must be an integer"
    if (!("limit" in body))
      return "Missing query parameter - limit"
    else if (isNaN(parseInt(body["limit"])))
      return "limit must be an integer"
  }
}

module.exports.getContent = async (event) => {
  console.log(event);
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

  console.log(typeof (event.queryStringParameters));
  const body = event.queryStringParameters;
  //body = JSON.parse(body);
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

  if ("ref_id" in body) {
    try {
      const sql_get_known = "SELECT * from known where ref_id='" + body["ref_id"] + "'";
      let results = await mysql.query(sql_get_known);
      await mysql.end();
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
      var get_data = "";
      if (is_asset) {
        get_data = "SELECT * from known_asset where ref_id='" + body["ref_id"] + "'";
      }
      else if (is_stream) {
        get_data = "SELECT * from known_stream where ref_id='" + body["ref_id"] + "'";
      }
      results = await mysql.query(get_data);
      await mysql.end();
      return {
        statusCode: 200,
        body: JSON.stringify(
          {
            data: results
          },
          null,
          2
        ),
      }
    }
    catch (e) {
      console.log("Error when executing SQL query.");
      console.log(e);
      return sql_error;
    }
  }
  else if (("content_type" in body) && ("limit" in body) && ("offset" in body)) {
    is_asset = body["content_type"].toLowerCase() == "asset" ? 1 : 0;
    is_stream = body["content_type"].toLowerCase() == "stream" ? 1 : 0;
    var get_data = "";
    if (is_asset) {
      get_data = "SELECT * from known_asset LIMIT " + parseInt(body["limit"]) + " OFFSET " + parseInt(body["offset"]);
    }
    else if (is_stream) {
      get_data = "SELECT * from known_stream LIMIT " + parseInt(body["limit"]) + " OFFSET " + parseInt(body["offset"]);
    }
    try {
      let results = await mysql.query(get_data);
      await mysql.end();
      return {
        statusCode: 200,
        body: JSON.stringify(
          {
            data: results
          },
          null,
          2
        ),
      }
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
        message: "Content fetched successfully!",
        input: event
      },
      null,
      2
    ),
  }
}