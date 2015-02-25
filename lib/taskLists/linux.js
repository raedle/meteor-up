var nodemiral = require('nodemiral');
var fs = require('fs');
var path = require('path');
var util = require('util');

var SCRIPT_DIR = path.resolve(__dirname, '../../scripts/linux');
var TEMPLATES_DIR = path.resolve(__dirname, '../../templates/linux');

exports.setup = function(config) {
  var taskList = nodemiral.taskList('Setup (linux)');

  // Installation
  if(config.setupNode) {
    taskList.executeScript('Installing Node.js', {
      script: path.resolve(SCRIPT_DIR, 'install-node.sh'),
      vars: {
        nodeVersion: config.nodeVersion
      }
    });
  }

  if(config.setupPhantom) {
    taskList.executeScript('Installing PhantomJS', {
      script: path.resolve(SCRIPT_DIR, 'install-phantomjs.sh')
    });
  }

  taskList.executeScript('Setting up Environment', {
    script: path.resolve(SCRIPT_DIR, 'setup-env.sh'),
    vars: {
      appName: config.appName
    }
  });

  if(config.setupMongo) {
    taskList.copy('Copying MongoDB configuration', {
      src: path.resolve(TEMPLATES_DIR, 'mongodb.conf'),
      dest: '/etc/mongodb.conf'
    });

    taskList.executeScript('Installing MongoDB', {
      script: path.resolve(SCRIPT_DIR, 'install-mongodb.sh')
    });
  }

  if(config.ssl) {
    installStud(taskList);
    configureStud(taskList, config.ssl.pem, config.ssl.backendPort);
  }

  //Configurations
  taskList.copy('Configuring upstart', {
    src: path.resolve(TEMPLATES_DIR, 'meteor.conf'),
    dest: '/etc/init/' + config.appName + '.conf',
    vars: {
      appName: config.appName
    }
  });

  return taskList;
};

exports.deploy = function(bundlePath, env, deployCheckWaitTime, appName) {
  var taskList = nodemiral.taskList("Deploy app '" + appName + "' (linux)");

  taskList.copy('Uploading bundle', {
    src: bundlePath,
    dest: '/opt/' + appName + '/tmp/bundle.tar.gz'
  });

  taskList.copy('Setting up Environment Variables', {
    src: path.resolve(TEMPLATES_DIR, 'env.sh'),
    dest: '/opt/' + appName + '/config/env.sh',
    vars: {
      env: env || {},
      appName: appName
    }
  });

  // deploying
  taskList.executeScript('Invoking deployment process', {
    script: path.resolve(TEMPLATES_DIR, 'deploy.sh'),
    vars: {
      deployCheckWaitTime: deployCheckWaitTime || 10,
      appName: appName
    }
  });

  return taskList;
};

exports.reconfig = function(env, appName) {
  var taskList = nodemiral.taskList("Updating configurations (linux)");

  taskList.copy('Setting up Environment Variables', {
    src: path.resolve(TEMPLATES_DIR, 'env.sh'),
    dest: '/opt/' + appName + '/config/env.sh',
    vars: {
      env: env || {},
      appName: appName
    }
  });

  //restarting
  taskList.execute('Restarting app', {
    command: '(sudo stop ' + appName + ' || :) && (sudo start ' + appName + ')'
  });

  return taskList;
};

exports.restart = function(appName) {
  var taskList = nodemiral.taskList("Restarting Application (linux)");

  //restarting
  taskList.execute('Restarting app', {
    command: '(sudo stop ' + appName + ' || :) && (sudo start ' + appName + ')'
  });

  return taskList;
};

exports.stop = function(appName) {
  var taskList = nodemiral.taskList("Stopping Application (linux)");

  //stopping
  taskList.execute('Stopping app', {
    command: '(sudo stop ' + appName + ')'
  });

  return taskList;
};

exports.start = function(appName) {
  var taskList = nodemiral.taskList("Starting Application (linux)");

  //starting
  taskList.execute('Starting app', {
    command: '(sudo start ' + appName + ')'
  });

  return taskList;
};

exports.pulldb = function(server, app, appName) {

  var taskList = nodemiral.taskList("Pulling Production Database (linux)");

  //dumping data
  taskList.execute('Dumping data (may take some time)', {
    command: '(sudo mongodump -d ' + appName + ' -o /opt/' + appName + '/tmp/dump/)'
  });

  //zip
  taskList.execute('Zipping dump', {
    command: '(sudo zip -r /opt/' + appName + '/tmp/dump.zip /opt/' + appName + '/tmp/dump/)'
  });

  taskList.executeLocal("Retrieving dump", {
    command: "scp -i " + server.pem + " " + server.username + "@" + server.host + ":/opt/" + appName + "/tmp/dump.zip ."
  });

  //delete dump
  taskList.execute('Deleting remote dump1', {
    command: '(sudo rm -rf /opt/' + appName + '/tmp/dump/)'
  });

  //delete dump
  taskList.execute('Deleting remote dump2', {
    command: '(sudo rm /opt/' + appName + '/tmp/dump.zip)'
  });

  taskList.executeLocal("Unzipping local dump1", {
    command: "unzip dump.zip"
  });

  taskList.executeLocal("Deleting local dump", {
    command: "rm dump.zip"
  });

  var mongoDbProcess;

  var mongoDbDir = app + "/.meteor/local/db";
  var startMongoDbCmd = "mongod";
  taskList.executeLocal("Starting local mongo database instance", {
    command: startMongoDbCmd,
    arguments: [
      "--bind_ip",
      "127.0.0.1",
      "--smallfiles",
      "--nohttpinterface",
      "--port",
      "3002",
      "--dbpath",
      "./"
    ],
    options: {
      cwd: mongoDbDir,
    },
    continueImmedidately: true,
    sleepTime: 1,
    onSuccess: function(value) {
      mongoDbProcess = value;
    }
  });

  var importDumpCmd = "mongorestore --db meteor -host 127.0.0.1 --port 3002 --drop opt/" + appName + "/tmp/dump/" + appName;
  taskList.executeLocal("Importing dump", {
    command: importDumpCmd,
    onSuccess: function() {
      if (mongoDbProcess) {
        mongoDbProcess.kill();
      }
    }
  });

  taskList.executeLocal("Deleting local dump2", {
    command: "rm -rf opt/"
  });

  return taskList;
};

function installStud(taskList) {
  taskList.executeScript('Installing Stud', {
    script: path.resolve(SCRIPT_DIR, 'install-stud.sh')
  });
}

function configureStud(taskList, pemFilePath, port) {
  var backend = {host: '127.0.0.1', port: port};

  taskList.copy('Configuring Stud for Upstart', {
    src: path.resolve(TEMPLATES_DIR, 'stud.init.conf'),
    dest: '/etc/init/stud.conf'
  });

  taskList.copy('Configuring SSL', {
    src: pemFilePath,
    dest: '/opt/stud/ssl.pem'
  });

  taskList.copy('Configuring Stud', {
    src: path.resolve(TEMPLATES_DIR, 'stud.conf'),
    dest: '/opt/stud/stud.conf',
    vars: {
      backend: util.format('[%s]:%d', backend.host, backend.port)
    }
  });

  //restart stud
  taskList.execute('Strating Stud', {
    command: '(sudo stop stud || :) && (sudo start stud || :)'
  });
}
