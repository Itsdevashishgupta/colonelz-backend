import AWS from "aws-sdk";
import dotenv from "dotenv";
import fileuploadModel from "../../../models/adminModels/fileuploadModel.js";
import projectModel from "../../../models/adminModels/project.model.js";
import { responseData } from "../../../utils/respounse.js";

dotenv.config();

const s3 = new AWS.S3({
  accessKeyId: process.env.ACCESS_KEY,
  secretAccessKey: process.env.SECRET_ACCESS_KEY,
  region: "ap-south-1",
});

function generateSixDigitNumber() {
  const min = 100000;
  const max = 999999;
  const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;

  return randomNumber;
}

const uploadFile = async (file, fileName, lead_id, folder_name) => {
  return s3
    .upload({
      Bucket: `collegemanage/${lead_id}/${folder_name}`,
      Key: fileName,
      Body: file.data,
      ContentType: file.mimetype,
      // ACL: 'public-read'
    })
    .promise();
};

const saveFileUploadData = async (
  res,
  existingFileUploadData,
  isFirst = false
) => {
  try {
    if (isFirst) {
      const firstFile = await fileuploadModel.create({
        project_id: existingFileUploadData.project_id,
        project_name: existingFileUploadData.project_name,
        files: [
          {
            folder_name: existingFileUploadData.folder_name,
            files: existingFileUploadData.files,
          },
        ],
      });
      responseData(res, "First file created successfully", 200, true);
    } else {
      // Use update query to push data
      const updateResult = await fileuploadModel.updateOne(
        {
          project_id: existingFileUploadData.project_id,
          "files.folder_name": existingFileUploadData.folder_name,
        },
        {
          $push: {
            "files.$.files": { $each: existingFileUploadData.files },
          },
        },
        {
          arrayFilters: [
            { "folder.folder_name": existingFileUploadData.folder_name },
          ],
        }
      );

      if (updateResult.modifiedCount === 1) {
        responseData(res, "File data updated successfully", 200, true);
      } else {
        // If the folder does not exist, create a new folder object
        const updateNewFolderResult = await fileuploadModel.updateOne(
          { project_id: existingFileUploadData.project_id },
          {
            $push: {
              files: {
                folder_name: existingFileUploadData.folder_name,
                files: existingFileUploadData.files,
              },
            },
          }
        );

        if (updateNewFolderResult.modifiedCount === 1) {
          responseData(res, "New folder created successfully", 200, true);
        } else {
          console.log("Lead not found or file data already updated");
          responseData(
            res,
            "",
            404,
            false,
            "Lead not found or file data already updated"
          );
        }
      }
    }
  } catch (error) {
    console.error("Error saving file upload data:", error);
    responseData(
      res,
      "",
      500,
      false,
      "Something went wrong. File data not updated"
    );
  }
};

const projectFileUpload = async (req, res) => {
  const folder_name = req.body.folder_name;
  const project_id = req.body.project_id;

  if (!project_id) {
    responseData(res, "", 401, false, "project Id required!", []);
  } else if (!folder_name) {
    responseData(res, "", 401, false, "folder name required!", []);
  } else {
    try {
      const find_project = await projectModel.find({ project_id: project_id });
      if (find_project.length < 1) {
        responseData(res, "", 404, false, "project not found!", []);
      }
      if (find_project.length > 0) {
        const project_name = find_project[0].project_name;
        const files = Array.isArray(req.files.files)
          ? req.files.files
          : [req.files.files]; // Assuming the client sends an array of files with the key 'files'
        const fileUploadPromises = [];
        const uploadfileName = [];
        if (!files || files.length === 0) {
          return res.send({
            message: "",
            statuscode: 400,
            status: false,
            errormessage: "No files provided",
            data: [],
          });
        }

        // Limit the number of files to upload to at most 5
        const filesToUpload = files.slice(0, 5);

        for (const file of filesToUpload) {
          const fileName = file.name;
          uploadfileName.push(file.name);
          fileUploadPromises.push(
            uploadFile(file, fileName, project_id, folder_name)
          );
        }

        const responses = await Promise.all(fileUploadPromises);
        // console.log(responses)
        const fileUploadResults = responses.map((response) => ({
          status: response.Location ? true : false,
          data: response ? response : response.err,
        }));
        // console.log(fileUploadResults)
        const successfullyUploadedFiles = fileUploadResults.filter(
          (result) => result.data
        );


        if (successfullyUploadedFiles.length > 0) {
          let fileUrls = successfullyUploadedFiles.map((result) => ({
            fileUrl: result.data.Location,
            fileName: result.data.Location.split('/').pop(),
            fileId: `FL-${generateSixDigitNumber()}`,
            date: new Date()

          }));

          const existingFile = await fileuploadModel.findOne({
            project_id: project_id,
          });

          if (existingFile) {
            await saveFileUploadData(res, {
              project_id,
              project_name,
              folder_name,
              files: fileUrls,
            });
          } else {
            await saveFileUploadData(
              res,
              {
                project_id,
                project_name,
                folder_name,
                files: fileUrls,
              },
              true
            );
          }
        } else {
          res.send({
            message: "",
            statuscode: 500,
            status: false,
            errormessage: "Error uploading files",
            data: [],
          });
        }
      }
    } catch (err) {
      res.send({
        message: "",
        statuscode: 500,
        status: false,
        errormessage: err.message,
        data: [],
      });
    }
  }
};

export default projectFileUpload;
