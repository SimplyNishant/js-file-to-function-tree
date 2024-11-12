const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const fs = require('fs');
const { exec } = require('child_process');

// List of standard/built-in functions to ignore
const standardFunctions = new Set([
    // DOM manipulation
    'getElementById', 'getElementsByTagName', 'getElementsByClassName', 
    'querySelector', 'querySelectorAll', 'createElement', 'appendChild',
    'removeChild', 'addEventListener', 'removeEventListener', 'click',
    'contains', 'getAttribute', 'setAttribute', 'remove', 'includes',
    'toString', 'trim', 'splice', 'slice', 'join', 'split', 'replace',
    'indexOf', 'push', 'pop', 'shift', 'unshift', 'filter', 'map',
    'forEach', 'find', 'findIndex', 'some', 'every', 'concat',
    // Browser APIs
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'postMessage', 'focus', 'blur', 'open', 'close', 'send',
    'onreadystatechange', 'readyState', 'status',
    // Standard methods
    'test', 'exec', 'match', 'search', 'length', 'substring',
    'toLowerCase', 'toUpperCase', 'charAt', 'charCodeAt',
    // Console methods
    'log', 'error', 'warn', 'info', 'debug',
    // Array methods
    'sort', 'reverse', 'reduce', 'reduceRight',
    // Object methods
    'hasOwnProperty', 'valueOf', 'toLocaleString',
    // JSON methods
    'parse', 'stringify',
]);

function countFunctionLines(node, code) {
    const start = node.loc.start.line;
    const end = node.loc.end.line;
    const functionBody = code.split('\n').slice(start - 1, end).join('\n');
    const nonEmptyLines = functionBody.split('\n')
        .filter(line => line.trim().length > 0)
        .length;
    return nonEmptyLines;
}
function analyzeFunctionCalls(filePath, functionsToRemove = []) {
    const code = fs.readFileSync(filePath, 'utf-8');
    const functionCalls = new Map();
    const functionLocations = new Map();
    const functionLines = new Map();
    const declaredFunctions = new Set();
    let modifiedCode = code;

    try {
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: [
                'jsx',
                'typescript',
                'classProperties',
                'optionalChaining',
                'decorators-legacy'
            ]
        });

        // First pass: collect all declared functions
        traverse(ast, {
            FunctionDeclaration(path) {
                const functionName = path.node.id.name;
                declaredFunctions.add(functionName);
                functionCalls.set(functionName, new Set());
                functionLocations.set(functionName, path.node.loc.start.line);
                functionLines.set(functionName, countFunctionLines(path.node, code));

                // Remove function if it's in the removal list
                if (functionsToRemove.includes(functionName)) {
                    path.remove();
                }
            },
            VariableDeclarator(path) {
                if (path.node.init && 
                    (path.node.init.type === 'FunctionExpression' || 
                     path.node.init.type === 'ArrowFunctionExpression')) {
                    const functionName = path.node.id.name;
                    declaredFunctions.add(functionName);
                    functionCalls.set(functionName, new Set());
                    functionLocations.set(functionName, path.node.loc.start.line);
                    functionLines.set(functionName, countFunctionLines(path.node.init, code));

                    // Remove function if it's in the removal list
                    if (functionsToRemove.includes(functionName)) {
                        path.remove();
                    }
                }
            }
        });

        // Second pass: track function calls for only declared functions
        traverse(ast, {
            CallExpression(path) {
                let callerName;
                let calleeName;

                let functionParent = path.getFunctionParent();
                if (functionParent) {
                    if (functionParent.node.id) {
                        callerName = functionParent.node.id.name;
                    } else if (functionParent.parent.type === 'VariableDeclarator') {
                        callerName = functionParent.parent.id.name;
                    }
                }

                if (path.node.callee.type === 'Identifier') {
                    calleeName = path.node.callee.name;
                } else if (path.node.callee.type === 'MemberExpression' && 
                         path.node.callee.property.type === 'Identifier') {
                    calleeName = path.node.callee.property.name;
                }

                // Only record calls between custom functions
                if (callerName && calleeName && 
                    declaredFunctions.has(callerName) && 
                    declaredFunctions.has(calleeName) &&
                    !standardFunctions.has(calleeName)) {
                    functionCalls.get(callerName).add(calleeName);
                }
            }
        });

        // Save modified code if any functions were removed
        if (functionsToRemove.length > 0) {
            const output = {
                code: modifiedCode,
                removedFunctions: functionsToRemove.filter(func => declaredFunctions.has(func))
            };
            fs.writeFileSync(filePath.replace('.js', '.modified.js'), modifiedCode);
            console.log(`\nModified code saved to: ${filePath.replace('.js', '.modified.js')}`);
            console.log('Removed functions:', output.removedFunctions);
        }

        const analysis = {
            functionLocations: Object.fromEntries(functionLocations),
            functionLines: Object.fromEntries(functionLines),
            functionCalls: Object.fromEntries([...functionCalls].map(([key, value]) => [key, [...value]])),
            roots: findRootFunctions(functionCalls),
            deadFunctions: findDeadFunctions(functionCalls),
        };

        return analysis;

    } catch (error) {
        console.error('Error analyzing file:', error);
        return null;
    }
}

// Find root functions (not called by other functions)
function findRootFunctions(functionCalls) {
    const calledFunctions = new Set();
    for (const calls of functionCalls.values()) {
        for (const call of calls) {
            calledFunctions.add(call);
        }
    }
    
    const roots = [];
    for (const func of functionCalls.keys()) {
        if (!calledFunctions.has(func)) {
            roots.push(func);
        }
    }
    return roots;
}

// Find dead functions (never called)
function findDeadFunctions(functionCalls) {
    const calledFunctions = new Set();
    const definedFunctions = new Set(functionCalls.keys());
    
    for (const calls of functionCalls.values()) {
        for (const call of calls) {
            calledFunctions.add(call);
        }
    }

    return [...definedFunctions].filter(func => !calledFunctions.has(func));
}

function generateMermaidDiagram(analysis) {
    let diagram = 'graph TD\n';
    
    // Sort functions by line count for better visualization
    const sortedFunctions = Object.entries(analysis.functionLines)
        .sort((a, b) => b[1] - a[1]);

    // Add relationships between functions
    for (const [caller, callees] of Object.entries(analysis.functionCalls)) {
        if (callees.length > 0) {
            for (const callee of callees) {
                // Include line count in the label
                diagram += `    ${caller}["${caller} (${analysis.functionLines[caller]} lines)<br>Line: ${analysis.functionLocations[caller]}"] --> ${callee}["${callee} (${analysis.functionLines[callee]} lines)<br>Line: ${analysis.functionLocations[callee]}"]\n`;
            }
        }
    }
    
    // Add root functions that have calls
    for (const rootFunc of analysis.roots) {
        if (analysis.functionCalls[rootFunc]?.length > 0) {
            diagram += `    ${rootFunc}["${rootFunc} (${analysis.functionLines[rootFunc]} lines)<br>Line: ${analysis.functionLocations[rootFunc]}"]\n`;
        }
    }
    
    return diagram;
}

async function saveDiagramAndGenerateSVG(analysis, outputPath = './output') {
    if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
    }

    const mermaidContent = generateMermaidDiagram(analysis);
    fs.writeFileSync(`${outputPath}/function-calls.mmd`, mermaidContent);

    exec('mmdc -v', async (error) => {
        if (error) {
            console.log('Installing mermaid-cli...');
            await new Promise((resolve, reject) => {
                exec('npm install -g @mermaid-js/mermaid-cli', (error) => {
                    if (error) {
                        console.error('Error installing mermaid-cli:', error);
                        reject(error);
                    } else {
                        console.log('mermaid-cli installed successfully');
                        resolve();
                    }
                });
            });
        }

        exec(`mmdc -i ${outputPath}/function-calls.mmd -o ${outputPath}/function-calls.svg`, (error, stdout, stderr) => {
            if (error) {
                console.error('Error generating SVG:', error);
                return;
            }
            console.log(`\nDiagram saved to: ${outputPath}/function-calls.svg`);
            
            // Print analysis results
            console.log('\nFunction Call Analysis:');
            console.log('====================');
            
            console.log('\nRoot Functions (Entry Points):');
            console.log(analysis.roots.filter(func => analysis.functionCalls[func]?.length > 0));
            
            console.log('\nFunction Relationships:');
            for (const [caller, callees] of Object.entries(analysis.functionCalls)) {
                if (callees.length > 0) {
                    console.log(`${caller} calls: ${callees.join(', ')}`);
                }
            }
        });
    });
}

const filePath = process.argv[2];
const outputPath = process.argv[3] || './output';
const functionsToRemove = process.argv[4] ? process.argv[4].split(',') : [];

if (!filePath) {
    console.error('Please provide a JavaScript file path');
    process.exit(1);
}

const analysis = analyzeFunctionCalls(filePath, functionsToRemove);

if (analysis) {
    // Print function size analysis
    console.log('\nFunction Sizes (sorted by lines of code):');
    console.log('======================================');
    Object.entries(analysis.functionLines)
        .sort((a, b) => b[1] - a[1])
        .forEach(([func, lines]) => {
            console.log(`${func}: ${lines} lines (Line ${analysis.functionLocations[func]})`);
        });

    saveDiagramAndGenerateSVG(analysis, outputPath);
}
