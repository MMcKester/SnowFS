/* eslint-disable max-len */
import * as fse from 'fs-extra';

import { intersection } from 'lodash';
import {
  isAbsolute, join, resolve, relative,
} from 'path';
import { Index } from './src/index';
import { Commit } from './src/commit';
import { DirItem, OSWALK, osWalk } from './src/io';
import { Reference } from './src/reference';
import {
  StatusEntry, FILTER, Repository, RESET,
} from './src/repository';
import { TreeDir, TreeFile } from './src/treedir';

const program = require('commander');
const chalk = require('chalk');

program
  .version('0.9.1')
  .description('SnowFS - a fast, scalable version control file storage for graphic files.');

program
  .command('init [path] [commondir]')
  .option('--debug', 'add more debug information on errors')
  .description('initialize a SnowFS repository')
  .action(async (path: string, commondir?: string, opts?: any) => {
    const repoPath: string = path ?? '.';
    try {
      await Repository.initExt(repoPath, { commondir });
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
    console.log(`Initialized empty SnowFS repository at ${resolve(repoPath)}`);
  });

program
  .command('rm [path]')
  .option('--debug', 'add more debug information on errors')
  .description('Remove files from the working tree and from the index')
  .action(async (path: string, opts?: any) => {
    try {
      const repo = await Repository.open(process.cwd());

      const filepathAbs: string = isAbsolute(path) ? path : join(repo.workdir(), path);
      fse.unlinkSync(filepathAbs);

      const index: Index = repo.getIndex();
      index.deleteFiles([path]);
      await index.writeFiles();
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

function fileMatch(relFilepath: string, relCwd: string, pathPattern: string): boolean {
  return pathPattern === '*' || (pathPattern === '.' && relFilepath.startsWith(relCwd)) || pathPattern === relative(relCwd, relFilepath);
}

program
  .command('add <path>')
  .option('--debug', 'add more debug information on errors')
  .description('add file contents to the index')
  .action(async (pathPattern: string, opts?: any) => {
    try {
      const repo = await Repository.open(process.cwd());

      const statusFiles: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_UNTRACKED);

      const relCwd = relative(repo.workdir(), process.cwd());

      const index: Index = repo.getIndex();
      for (const file of statusFiles) {
        if (file.isNew() || file.isModified()) {
          if (fileMatch(file.path, relCwd, pathPattern)) {
            index.addFiles([file.path]);
          }
        }
      }
      for (const file of statusFiles) {
        if (file.isDeleted()) {
          if (fileMatch(file.path, relCwd, pathPattern)) {
            index.deleteFiles([file.path]);
          }
        }
      }
      await index.writeFiles();
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

program
  .command('branch [branch-name] [start-point]')
  .option('--debug', 'add more debug information on errors')
  .option('--no-color')
  .description('create a new branch')
  .action(async (branchName: string | undefined, startPoint: string, opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      const repo = await Repository.open(process.cwd());
      await repo.createNewReference(branchName, startPoint, startPoint);
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

const checkoutDesc = `checkout a commit, or create a branch

${chalk.bold('Examples')}

    Checkout a commit
      $ snow checkout 75f4d24726ce95dde1376c19a1ce16e53e7b1db7ffcb508f8abf57026784c040

      - If there is only one reference pointing to '75f4d24..' then the reference is checked out.
        If you still need to be in a detached head after the command, pass '-d'.

      - If there is more than one reference pointing to '75f4d24..' an error is raised.

      - If no reference is pointing to '75f4d24..', then the commit is checked out.

    Create a new branch
      $ snow checkout -b <branch-name> <start-point>
      
      - The branch must not exist yet, otherwise an error is raised`;

program
  .command('checkout [target]')
  .option('-b, --branch <branch-name>')
  .option('-d, --detach', 'detach the branch')
  .option('-n, --no-reset', "don't modify the worktree")
  .option('--debug', 'add more debug information on errors')
  .option('--no-color')
  .description(checkoutDesc)
  .action(async (target: string | undefined, opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      const repo = await Repository.open(process.cwd());

      if (opts.branch) { // snow checkout -b branch-name
        await repo.createNewReference(opts.branch, repo.getHead().hash, repo.getHead().hash);
      } else if (target) { // snow checkout [hash]
        let reset: RESET = RESET.NONE;
        if (opts.reset) {
          reset |= RESET.DEFAULT;
        }
        if (opts.detach) {
          reset |= RESET.DETACH;
        }
        await repo.restore(target, reset);
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

program
  .command('status')
  .option('--no-color')
  .option('--output [format]', "currently supported output formats 'json', 'json-pretty'")
  .option('--debug', 'add more debug information on errors')
  .description('show the working tree status')
  .action(async (opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      const repo = await Repository.open(process.cwd());

      const files: StatusEntry[] = await repo.getStatus(FILTER.INCLUDE_IGNORED | FILTER.INCLUDE_UNTRACKED);
      const newFiles: StatusEntry[] = [];
      const modifiedFiles: StatusEntry[] = [];
      const deletedFiles: StatusEntry[] = [];
      for (const file of files) {
        if (file.isNew()) {
          newFiles.push(file);
        } else if (file.isModified()) {
          modifiedFiles.push(file);
        } else if (file.isDeleted()) {
          deletedFiles.push(file);
        }
      }

      const index = repo.getIndex();

      if (opts.output === 'json' || opts.output === 'json-pretty') {
        const o = { new_files: newFiles, modified_files: modifiedFiles, deleted_files: deletedFiles };

        process.stdout.write(JSON.stringify(o, (key, value) => {
          if (value instanceof StatusEntry) {
            return {
              path: value.path, isdir: value.isdir,
            };
          }
          return value;
        }, opts.output === 'json-pretty' ? '   ' : ''));
      } else {
        console.log(`On branch ${repo.getHead().getName()}`);
        console.log('Changes not staged for commit:');
        console.log('use "snow add <file>..." to update what will be committed');
        // console.log(`use "snow restore <file>..." to discard changes in working directory`);
        for (const modifiedFile of modifiedFiles) {
          console.log(modifiedFile.path);
        }
        process.stdout.write('\n');
        if (deletedFiles.length > 0) {
          console.log('Deleted files:');
          for (const deleteFile of deletedFiles) {
            console.log(deleteFile.path);
          }
        } else {
          console.log('no deleted changes added to commit (use "snow rm")');
        }
        process.stdout.write('\n');
        if (newFiles.length > 0) {
          console.log('New files:');
          for (const newFile of newFiles) {
            if (index.adds.has(relative(repo.workdir(), newFile.path))) {
              process.stdout.write(chalk.red('+ '));
            }
            console.log(newFile.path);
          }
        } else {
          console.log('no changes added to commit (use "snow add"');
        }
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

program
  .command('commit')
  .option('-m, --message [message]', 'input file')
  .option('--allow-empty', 'allow an empty commit without any changes, not set by default')
  .option('--debug', 'add more debug information on errors')
  .description('complete the commit')
  .action(async (opts: any) => {
    try {
      const repo = await Repository.open(process.cwd());
      const index: Index = repo.getIndex();

      const newCommit: Commit = await repo.createCommit(index, opts.message, opts);

      console.log(`[${repo.getHead().getName()} (root-commit) ${newCommit.hash.substr(0, 6)}]`);
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

program
  .command('log')
  .option('--no-color')
  .option('-v, --verbose', 'verbose')
  .option('--output [format]', "currently supported output formats 'json', 'json-pretty'")
  .option('--debug', 'add more debug information on errors')
  .description('print the log to the console')
  .action(async (opts: any) => {
    if (opts.noColor) {
      chalk.level = 0;
    }

    try {
      const repo = await Repository.open(process.cwd());

      const commits: Commit[] = repo.getAllCommits();
      commits.sort((a: Commit, b: Commit) => {
        const aDate = a.date.getTime();
        const bDate = b.date.getTime();
        if (aDate > bDate) {
          return 1;
        }
        if (aDate < bDate) {
          return -1;
        }
        return 0;
      });

      const refs: Reference[] = repo.getAllReferences();
      const head: Reference = repo.getHead();

      if (opts.output === 'json' || opts.output === 'json-pretty') {
        commits.reverse();
        const o = { commits, refs, head: head.isDetached() ? head.hash : head.getName() };

        process.stdout.write(JSON.stringify(o, (key, value) => {
          if (value instanceof Commit) {
            return {
              hash: value.hash, message: value.message, date: value.date.getTime() / 1000.0, root: opts.verbose ? value.root : undefined,
            };
          }
          if (value instanceof TreeDir) {
            return { path: value.path, hash: value.hash, children: value.children };
          }
          if (value instanceof TreeFile) {
            return {
              path: value.path,
              hash: value.hash,
              ctime: value.ctime / 1000.0,
              mtime: value.mtime / 1000.0,
              size: value.size,
            };
          }
          if (value instanceof Reference) {
            return { name: value.getName(), hash: value.hash, start: value.start };
          }
          return value;
        }, opts.output === 'json-pretty' ? '   ' : ''));
      } else {
        commits.reverse();
        for (const commit of commits) {
          process.stdout.write(chalk.magenta.bold(`commit: ${commit.hash}`));

          const branchRefs: Reference[] = refs.filter((ref: Reference) => ref.hash === commit.hash);

          if (branchRefs.length > 0) {
            process.stdout.write('  (');

            process.stdout.write(`${branchRefs.map((ref) => {
              if (ref.hash === commit.hash) {
                if (ref.getName() === head.getName()) {
                  if (head.isDetached()) {
                    return chalk.blue.bold(ref.getName());
                  }
                  return chalk.blue.bold(`HEAD -> ${ref.getName()}`);
                }
                return chalk.rgb(255, 165, 0)(ref.getName());
              }
              return null;
            }).filter((x) => !!x).join(', ')}`);

            process.stdout.write(')');
          }
          process.stdout.write('\n');

          process.stdout.write(`Date: ${commit.date}\n`);
          process.stdout.write(`\n  ${commit.message}\n\n`);
          if (opts.verbose) {
            const files = commit.root.getAllTreeFiles({ entireHierarchy: true, includeDirs: true });
            for (const file of Array.from(files)) {
              process.stdout.write(`      ${file[0]}\n`);
            }
            if (files.size > 0) {
              process.stdout.write('\n');
            }
          }
        }
      }
    } catch (error) {
      if (opts.debug) {
        throw error;
      } else {
        console.log(`fatal: ${error.message}`);
        process.exit(-1);
      }
    }
  });

program.parse(process.argv.filter((x) => x !== '--'));
