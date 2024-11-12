# js-file-to-function-tree
Create a mermaid &amp; svg tree of the function calling from a js file, with the no. of lines consumed by each function. should be helpful for doing quick scan/xray of unknown js file.

**Installation:**
First install the required packages:

    npm install @babel/parser @babel/traverse
    npm install -g @mermaid-js/mermaid-cli

**Usage**
You can use this script in three ways:

**Basic analysis:**

    node js-function-tree.js your-file.js

**Analysis with custom output directory:**

	node js-function-tree.js your-file.js ./custom-output

**Analysis with functions to remove:**

	node js-function-tree.js your-file.js ./output "function1,function2,function3"

The output now includes:
 - Function sizes sorted by line count Mermaid diagram with line counts for each function
 - Modified file with specified functions removed
 - Original function relationships and entry points

The generated diagram will show:
 - Function names 
 - Number of lines in each function 
 - Line number where function is defined 
 - Call relationships between functions

