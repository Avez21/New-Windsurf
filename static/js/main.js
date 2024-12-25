let stats = JSON.parse(localStorage.getItem('scannerStats')) || {
    total: 0,
    matched: 0,
    unmatched: 0
};

let scanning = false;

// Track scanned barcodes
let scannedBarcodes = new Set();

// Track matched and unmatched barcodes
let matchedBarcodes = new Set(JSON.parse(localStorage.getItem('matchedBarcodes') || '[]'));
let unmatchedBarcodes = new Set(JSON.parse(localStorage.getItem('unmatchedBarcodes') || '[]'));

// Initialize Bootstrap modal
const resultModal = new bootstrap.Modal(document.getElementById('resultModal'));

// Update statistics display and save to localStorage
function updateStats() {
    document.getElementById('totalCount').textContent = stats.total;
    document.getElementById('matchedCount').textContent = stats.matched;
    document.getElementById('unmatchedCount').textContent = stats.unmatched;
    localStorage.setItem('scannerStats', JSON.stringify(stats));
    
    // Save Sets to localStorage
    localStorage.setItem('matchedBarcodes', JSON.stringify([...matchedBarcodes]));
    localStorage.setItem('unmatchedBarcodes', JSON.stringify([...unmatchedBarcodes]));
}

// Update barcode count in input area
function updateBarcodeCount() {
    const barcodeList = document.getElementById('barcodeList').value;
    const barcodes = barcodeList.split(/[\n,]+/).filter(code => code.trim() !== '');
    document.getElementById('barcodeCount').textContent = barcodes.length;
    
    // Enable/disable start scanning button
    const startButton = document.getElementById('startScanning');
    startButton.disabled = barcodes.length === 0;
    if (barcodes.length === 0) {
        startButton.classList.add('btn-secondary');
        startButton.classList.remove('btn-primary');
    } else {
        startButton.classList.add('btn-primary');
        startButton.classList.remove('btn-secondary');
    }
}

// Initialize stats on page load
document.addEventListener('DOMContentLoaded', function() {
    updateStats();
    updateBarcodeCount();
    
    // Restore saved barcode list from localStorage
    const savedBarcodeList = localStorage.getItem('barcodeList');
    if (savedBarcodeList) {
        document.getElementById('barcodeList').value = savedBarcodeList;
        updateBarcodeCount();
    }
    
    // Add input event listener for barcode list
    document.getElementById('barcodeList').addEventListener('input', function() {
        updateBarcodeCount();
        // Save to localStorage whenever input changes
        localStorage.setItem('barcodeList', this.value);
    });
});

// Initialize Quagga scanner
function initQuagga() {
    Quagga.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: document.querySelector("#interactive"),
            constraints: {
                facingMode: "environment",
                width: 1280,
                height: 720,
                aspectRatio: { min: 1, max: 2 }
            },
            area: { // Define scan area
                top: "0%",    
                right: "0%",  
                left: "0%",   
                bottom: "0%"  
            },
        },
        decoder: {
            readers: [
                "code_128_reader",
                "ean_reader",
                "ean_8_reader",
                "code_39_reader",
                "upc_reader",
                "upc_e_reader",
                "codabar_reader"
            ],
            debug: {
                drawBoundingBox: true,
                showFrequency: true,
                drawScanline: true,
                showPattern: true
            },
            multiple: false
        },
        locate: true,
        frequency: 15,
        locator: {
            patchSize: "medium",
            halfSample: true,
            debug: {
                showCanvas: true,
                showPatches: true,
                showFoundPatches: true,
                showSkeleton: true,
                showLabels: true,
                showPatchLabels: true,
                showRemainingPatchLabels: true
            }
        },
        numOfWorkers: 4,
    }, function(err) {
        if (err) {
            console.error(err);
            alert("Error initializing scanner. Please check camera permissions.");
            return;
        }
        console.log("Scanner initialized successfully");
        Quagga.start();
        showScanningGuide();
    });
}

let lastScannedCode = null;
let lastScannedTime = 0;
const SCAN_DELAY = 1000; // 1 second delay between scans
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 10;
const BUFFER_SIZE = 3; // Reduced buffer size for faster detection

// Show scanning guide message
function showScanningGuide() {
    document.querySelector('.scanner-status').classList.add('active');
    document.querySelector('.analyzing-indicator').classList.remove('active');
}

// Update scanning guide message
function updateScanningGuide(message) {
    const statusElement = document.querySelector('.scanner-status');
    statusElement.textContent = message;
    statusElement.classList.add('active');
}

// Show analyzing indicator
function showAnalyzing() {
    document.querySelector('.analyzing-indicator').classList.add('active');
}

// Hide analyzing indicator
function hideAnalyzing() {
    document.querySelector('.analyzing-indicator').classList.remove('active');
}

// Track detection quality
let detectionBuffer = [];

function updateDetectionBuffer(result) {
    detectionBuffer.push(result);
    if (detectionBuffer.length > BUFFER_SIZE) {
        detectionBuffer.shift();
    }
}

function isStableDetection() {
    if (detectionBuffer.length < BUFFER_SIZE) return false;
    
    const codes = detectionBuffer.map(r => r.codeResult.code);
    const mostFrequent = codes.sort((a,b) =>
        codes.filter(v => v === a).length - codes.filter(v => v === b).length
    ).pop();
    
    const frequency = codes.filter(c => c === mostFrequent).length;
    return frequency >= Math.ceil(BUFFER_SIZE * 0.5); // 50% agreement
}

// Function to download barcodes as text file
function downloadBarcodes(barcodes, filename) {
    const content = Array.from(barcodes).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Function to get remaining unmatched barcodes from original list
function getRemainingBarcodes() {
    const barcodeList = document.getElementById('barcodeList').value;
    const barcodes = barcodeList.split(/[\n,]+/).map(code => code.trim()).filter(code => code !== '');
    const remainingBarcodes = new Set(barcodes.filter(code => !matchedBarcodes.has(code)));
    return remainingBarcodes;
}

// Handle successful scans with improved confidence check
Quagga.onDetected(function(result) {
    if (!scanning) return;
    
    const currentTime = new Date().getTime();
    const code = result.codeResult.code;
    const confidence = result.codeResult.confidence;
    
    updateDetectionBuffer(result);
    showAnalyzing();
    
    // Reduced confidence threshold
    if (confidence < 0.45) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            updateScanningGuide('Align barcode within frame');
            consecutiveFailures = 0;
        }
        return;
    }
    
    if (!isStableDetection()) {
        updateScanningGuide('Hold steady...');
        return;
    }
    
    // Reset failure counter on successful detection
    consecutiveFailures = 0;
    
    // Check for duplicate scans with reduced delay
    if (lastScannedCode === code && (currentTime - lastScannedTime) < SCAN_DELAY) {
        return;
    }
    
    // Update last scanned info
    lastScannedCode = code;
    lastScannedTime = currentTime;
    
    const barcodeList = document.getElementById('barcodeList').value;
    scanning = false;
    
    // Send to backend for verification
    fetch('/api/check-barcode', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            barcode: code,
            barcodeList: barcodeList
        })
    })
    .then(response => response.json())
    .then(data => {
        hideAnalyzing();
        
        if (data.match) {
            if (matchedBarcodes.has(code)) {
                // Already scanned item
                document.getElementById('resultMessage').className = 'text-warning';
                document.getElementById('resultMessage').textContent = 'Already Scanned!';
            } else {
                // New matched item
                stats.total++;
                stats.matched++;
                matchedBarcodes.add(code);
                document.getElementById('resultMessage').className = 'matched';
                document.getElementById('resultMessage').textContent = 'Matched!';
            }
        } else {
            // Always count unmatched barcodes
            stats.total++;
            stats.unmatched++;
            unmatchedBarcodes.add(code);
            document.getElementById('resultMessage').className = 'not-matched';
            document.getElementById('resultMessage').textContent = 'Not Matched!';
        }
        
        updateStats();
        document.getElementById('scannedBarcode').textContent = code;
        resultModal.show();
        
        document.getElementById('resultModal').addEventListener('hidden.bs.modal', function () {
            scanning = true;
            showScanningGuide();
        }, { once: true });
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Error processing barcode');
        scanning = true;
        hideAnalyzing();
        showScanningGuide();
    });
});

// Enhanced processing feedback
Quagga.onProcessed(function(result) {
    var drawingCtx = Quagga.canvas.ctx.overlay,
        drawingCanvas = Quagga.canvas.dom.overlay;

    if (result) {
        if (drawingCanvas && drawingCanvas.getAttribute("width")) {
            drawingCtx.clearRect(0, 0, parseInt(drawingCanvas.getAttribute("width")), parseInt(drawingCanvas.getAttribute("height")));
        }

        if (result.boxes) {
            drawingCtx.strokeStyle = 'green';
            drawingCtx.lineWidth = 2;

            result.boxes.filter(function (box) {
                return box !== result.box;
            }).forEach(function (box) {
                Quagga.ImageDebug.drawPath(box, {x: 0, y: 1}, drawingCtx, {color: "green", lineWidth: 2});
            });
        }

        if (result.box) {
            drawingCtx.strokeStyle = 'blue';
            drawingCtx.lineWidth = 2;
            Quagga.ImageDebug.drawPath(result.box, {x: 0, y: 1}, drawingCtx, {color: "#00F", lineWidth: 2});
            showAnalyzing();
        } else {
            hideAnalyzing();
        }

        if (result.codeResult && result.codeResult.code) {
            const confidence = Math.round(result.codeResult.confidence * 100);
            updateScanningGuide(`Confidence: ${confidence}%`);
        }
    }
});

// Event Listeners
document.getElementById('startScanning').addEventListener('click', function() {
    scanning = !scanning;
    if (scanning) {
        this.textContent = 'Stop Scanning';
        this.classList.replace('btn-primary', 'btn-danger');
        initQuagga();
    } else {
        this.textContent = 'Start Scanning';
        this.classList.replace('btn-danger', 'btn-primary');
        Quagga.stop();
    }
});

document.getElementById('saveList').addEventListener('click', function() {
    const barcodeList = document.getElementById('barcodeList').value;
    if (!barcodeList.trim()) {
        alert('Please enter some barcodes before saving');
        return;
    }
    
    // Download original list
    const blob = new Blob([barcodeList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'barcode_list.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Download matched barcodes if any exist
    if (matchedBarcodes.size > 0) {
        downloadBarcodes(matchedBarcodes, 'matched_barcodes.txt');
    }
    
    // Download unmatched barcodes if any exist
    if (unmatchedBarcodes.size > 0) {
        downloadBarcodes(unmatchedBarcodes, 'unmatched_barcodes.txt');
    }
    
    // Download remaining barcodes if any exist
    const remainingBarcodes = getRemainingBarcodes();
    if (remainingBarcodes.size > 0) {
        downloadBarcodes(remainingBarcodes, 'remaining_barcodes.txt');
    }
});

document.getElementById('clearAll').addEventListener('click', function() {
    if (confirm('Are you sure you want to clear all data? This will reset all statistics.')) {
        document.getElementById('barcodeList').value = '';
        stats = {
            total: 0,
            matched: 0,
            unmatched: 0
        };
        matchedBarcodes.clear();
        unmatchedBarcodes.clear();
        updateStats();
        updateBarcodeCount();
        localStorage.removeItem('scannerStats');
        localStorage.removeItem('barcodeList');
        localStorage.removeItem('matchedBarcodes');
        localStorage.removeItem('unmatchedBarcodes');
    }
});

document.getElementById('exportStats').addEventListener('click', function() {
    const statsData = {
        timestamp: new Date().toISOString(),
        statistics: stats,
        barcodeList: document.getElementById('barcodeList').value
    };
    
    const blob = new Blob([JSON.stringify(statsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'barcode-statistics.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Clear modal input when it's opened
document.getElementById('saveModal').addEventListener('show.bs.modal', function () {
    document.getElementById('listName').value = '';
});

// File Import Functionality
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

function handleFile(file) {
    if (!file.type.match('text.*') && !file.name.endsWith('.csv')) {
        alert('Please upload a text or CSV file');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        const barcodeList = document.getElementById('barcodeList');
        
        // Append new content to existing content
        if (barcodeList.value) {
            barcodeList.value += '\n' + content;
        } else {
            barcodeList.value = content;
        }
        
        updateBarcodeCount();
        localStorage.setItem('barcodeList', barcodeList.value);
    };
    reader.readAsText(file);
}

// Search Functionality
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');
const matchList = document.getElementById('matchList');
const matchCount = document.getElementById('matchCount');

function searchBarcodes() {
    const query = searchInput.value.trim().toLowerCase();
    const barcodeList = document.getElementById('barcodeList');
    const barcodes = barcodeList.value.split(/[\n,]+/).map(code => code.trim()).filter(Boolean);
    
    if (!query) {
        searchResults.style.display = 'none';
        return;
    }
    
    const matches = barcodes.filter(code => 
        code.toLowerCase().includes(query)
    );
    
    // Update match count
    matchCount.textContent = matches.length;
    
    // Show/hide results container
    searchResults.style.display = matches.length > 0 ? 'block' : 'none';
    
    if (matches.length > 0) {
        // Generate results HTML
        matchList.innerHTML = matches.map(code => {
            const isMatched = matchedBarcodes.has(code);
            return `
                <div class="match-item ${isMatched ? 'matched' : 'unmatched'}">
                    <span>${code}</span>
                    <span class="match-status ${isMatched ? 'matched' : 'unmatched'}">
                        ${isMatched ? 'Scanned' : 'Not Scanned'}
                    </span>
                </div>
            `;
        }).join('');
    } else {
        matchList.innerHTML = '<div class="no-results">No matching barcodes found</div>';
    }
}

// Real-time search as you type
searchInput.addEventListener('input', searchBarcodes);

// Clear search
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        searchInput.value = '';
        searchResults.style.display = 'none';
        searchInput.blur();
    }
});
