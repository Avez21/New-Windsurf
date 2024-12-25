from flask import Flask, render_template, request, jsonify
from datetime import datetime

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/check-barcode', methods=['POST'])
def check_barcode():
    data = request.json
    scanned_barcode = data.get('barcode', '')
    barcode_list = data.get('barcodeList', '')
    
    # Split by newlines and commas, then clean the barcode list
    barcodes = []
    for line in barcode_list.split('\n'):
        barcodes.extend([b.strip() for b in line.split(',') if b.strip()])
    
    # Check if scanned barcode exists in the list
    is_match = scanned_barcode in barcodes
    
    return jsonify({
        'match': is_match,
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    app.run(debug=True)
