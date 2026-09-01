const insert = async (db, document) => (await db.query(`INSERT INTO commercial_documents(
  client_id,development_id,package_id,certificate_id,document_type,document_reference,
  source_authority_type,source_authority_id,source_snapshot_ids,document_schema_version,
  template_version,render_payload,recipient_snapshot,mime_type,page_count,binary_data,sha256,
  generated_by,generated_at,supersedes_document_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'application/pdf',$14,$15,$16,$17,$18,$19)
  RETURNING *`,[
  document.clientId,document.developmentId,document.packageId,document.certificateId,
  document.documentType,document.documentReference,document.sourceAuthorityType,
  document.sourceAuthorityId,JSON.stringify(document.sourceSnapshotIds),document.documentSchemaVersion,
  document.templateVersion,JSON.stringify(document.renderPayload),JSON.stringify(document.recipientSnapshot),
  document.pageCount,document.binary,document.sha256,document.actor,document.generatedAt,document.supersedesDocumentId||null,
])).rows[0];

const findMetadata = async (db, clientId, documentId) => (await db.query(
  `SELECT id,client_id,development_id,package_id,certificate_id,document_type,document_reference,
   source_authority_type,source_authority_id,source_snapshot_ids,document_schema_version,template_version,
   render_payload,recipient_snapshot,mime_type,page_count,sha256,status,generated_by,generated_at,
   issued_by,issued_at,supersedes_document_id,version
   FROM commercial_documents WHERE client_id=$1 AND id=$2`,[clientId,documentId])).rows[0]||null;

const findBinary = async (db, clientId, documentId) => (await db.query(
  `SELECT id,document_reference,mime_type,binary_data,sha256,status FROM commercial_documents WHERE client_id=$1 AND id=$2`,
  [clientId,documentId])).rows[0]||null;

module.exports={insert,findMetadata,findBinary};
