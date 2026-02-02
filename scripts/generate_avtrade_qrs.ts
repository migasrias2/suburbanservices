
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const CUSTOMER_NAME = 'Avtrade';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const AREAS = [
  "East Ladies Shower",
  "East Mens Showers",
  "West Mens Showers",
  "HQ Mens Showers",
  "West Ladies Showers",
  "HQ Ladies Showers",
  "East Logistics Boardroom",
  "East Logistics Kitchen",
  "East Logistics Canteen",
  "East Logistics Office",
  "West Office (First Room)",
  "West Office (Second Room)",
  "General"
];

function sanitizeSegment(value: string) {
  return (value || 'unknown')
    .toString()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'unknown';
}

async function generateQRCode(data: any): Promise<string> {
  return QRCode.toDataURL(JSON.stringify(data), {
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });
}

async function processArea(areaName: string) {
  console.log(`Processing area: ${areaName}`);

  const qrId = uuidv4();
  const now = new Date().toISOString();

  // 1. Construct QR Data
  // Based on QRService.createManualQRCode logic
  const qrData = {
    id: qrId,
    type: 'AREA', // Most appropriate type for these
    customerName: CUSTOMER_NAME,
    metadata: {
      areaName: areaName,
      generatedAt: now,
      source: 'script_generated'
    }
  };

  try {
    // 2. Generate QR Image
    const dataUrl = await generateQRCode(qrData);
    
    // Convert data URL to Blob/Buffer for upload
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    // 3. Upload to Storage
    const sanitizedCustomer = sanitizeSegment(CUSTOMER_NAME);
    const sanitizedArea = sanitizeSegment(areaName);
    const storagePath = `manual/${sanitizedCustomer}/${sanitizedArea}/${qrId}.png`;
    
    const { error: uploadError } = await supabase.storage
      .from('qr-codes')
      .upload(storagePath, buffer, {
        contentType: 'image/png',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from('qr-codes')
      .getPublicUrl(storagePath);
      
    const storageUrl = publicUrlData.publicUrl;

    // 4. Insert into building_qr_codes
    const { error: dbError } = await supabase
      .from('building_qr_codes')
      .upsert({
        qr_code_id: qrId,
        customer_name: CUSTOMER_NAME,
        building_area: areaName,
        area_description: `Area QR Code - ${areaName}`,
        qr_code_url: JSON.stringify(qrData),
        qr_code_image_path: storageUrl,
        is_active: true,
        created_at: now
      }, { onConflict: 'customer_name,building_area' });

    if (dbError) {
      throw new Error(`DB Insert failed: ${dbError.message}`);
    }

    console.log(`  - Created QR Code record: ${qrId}`);

    // 5. Update existing area_tasks to link to this QR code
    // This ensures scanning loads the tasks
    const { data: updatedTasks, error: updateError } = await supabase
      .from('area_tasks')
      .update({ qr_code: qrId })
      .eq('customer_name', CUSTOMER_NAME)
      .eq('area', areaName)
      .select();

    if (updateError) {
      console.warn(`  - Warning: Failed to link tasks: ${updateError.message}`);
    } else {
      console.log(`  - Linked ${updatedTasks.length} tasks to this QR code.`);
    }

    console.log(`  - Success! URL: ${storageUrl}`);

  } catch (err: any) {
    console.error(`  - Failed: ${err.message}`);
  }
}

async function main() {
  console.log(`Starting QR Generation for ${CUSTOMER_NAME}...`);
  console.log(`Found ${AREAS.length} areas to process.`);

  for (const area of AREAS) {
    await processArea(area);
  }

  console.log('Done.');
}

main();
